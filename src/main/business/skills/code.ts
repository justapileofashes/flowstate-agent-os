// Code skills for the coder role. github.open_pr writes a reviewable branch
// + pull request to the owner's repository (never main; never CI workflow
// files, which would run with repo secrets on push). deploy.trigger calls a
// deploy hook (Vercel / Netlify / Render) and is always owner-approved.

import { z } from 'zod';
import { readJson, skillToolName, type Skill, type SkillContext } from './types';

const GH = 'https://api.github.com';

export function parseRepo(raw: string): { owner: string; repo: string } | null {
  const m = /(?:github\.com[/:])?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(raw.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export function safeRepoPath(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  if (!norm || norm.startsWith('/') || norm.split('/').some((seg) => seg === '..' || seg === '')) return false;
  if (/^\.github\//i.test(norm)) return false; // workflows run with repo secrets
  return !/(^|\/)\.git(\/|$)/.test(norm);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function ghRepo(ctx: SkillContext): { token: string; owner: string; repo: string } {
  const cred = ctx.credentials.resolve('github');
  if (!cred) throw new Error('GitHub is not connected');
  const r = parseRepo(cred.meta['repo'] || ctx.company.config.links.repo);
  if (!r) throw new Error('no repository configured (set it on the GitHub credential or the company links)');
  return { token: cred.secret.reveal(), ...r };
}

const prArgs = z.object({
  title: z.string().min(5).max(200),
  body: z.string().min(10).max(20_000),
  files: z
    .array(z.object({ path: z.string().min(1).max(300), content: z.string().max(200_000) }))
    .min(1)
    .max(20),
  base: z.string().max(100).optional(),
});

export const githubOpenPr: Skill<z.infer<typeof prArgs>> = {
  key: 'github.open_pr',
  toolName: skillToolName('github.open_pr'),
  name: 'Open a pull request',
  description:
    "Commit whole-file changes to a new branch on the owner's GitHub repo and open a pull request for review. Never touches the default branch directly; .github/ is off-limits.",
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string', description: 'What changed, why, and how it was verified.' },
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string', description: 'Full new file content' } },
          required: ['path', 'content'],
        },
      },
      base: { type: 'string', description: 'Base branch (default: the repo default).' },
    },
    required: ['title', 'body', 'files'],
  },
  schema: prArgs,
  category: 'external_write',
  risk: 'medium',
  costCredits: 2,
  channel: 'code',
  providers: ['github'],
  rubric: ['Change is small and focused', 'PR body explains verification', 'No secrets in code'],
  failureConditions: ['Repo not configured', 'Path outside the repo or in .github/'],
  precondition(_ctx, a) {
    const bad = a.files.find((f) => !safeRepoPath(f.path));
    return bad ? { ok: false, reason: `path not allowed: ${bad.path}` } : { ok: true };
  },
  preview: (a) => ({
    title: `PR: ${a.title}`,
    summary: `${a.body}\n\nFiles: ${a.files.map((f) => f.path).join(', ')}`,
  }),
  async execute(ctx, a, exec) {
    const { token, owner, repo } = ghRepo(ctx);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'flowstate-business-agent',
      'Content-Type': 'application/json',
    };
    const gh = async (method: string, path: string, body?: unknown): Promise<Response> =>
      ctx.fetch(`${GH}/repos/${owner}/${repo}${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    const info = (await readJson(await gh('GET', ''), 'GitHub')) as { default_branch: string };
    const base = a.base ?? info.default_branch;
    const ref = (await readJson(await gh('GET', `/git/ref/heads/${encodeURIComponent(base)}`), 'GitHub')) as {
      object: { sha: string };
    };
    const baseCommit = (await readJson(await gh('GET', `/git/commits/${ref.object.sha}`), 'GitHub')) as { tree: { sha: string } };
    const tree = (await readJson(
      await gh('POST', '/git/trees', {
        base_tree: baseCommit.tree.sha,
        tree: a.files.map((f) => ({ path: f.path.replace(/\\/g, '/'), mode: '100644', type: 'blob', content: f.content })),
      }),
      'GitHub',
    )) as { sha: string };
    const commit = (await readJson(
      await gh('POST', '/git/commits', { message: a.title, tree: tree.sha, parents: [ref.object.sha] }),
      'GitHub',
    )) as { sha: string };
    // Deterministic branch name: a retry of the same action reuses it.
    const branch = `flowstate/${slug(a.title)}-${exec.idempotencyKey.slice(0, 7)}`;
    const refRes = await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
    if (refRes.status === 422) {
      await readJson(await gh('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha, force: true }), 'GitHub');
    } else {
      await readJson(refRes, 'GitHub');
    }
    const prRes = await gh('POST', '/pulls', { title: a.title, head: branch, base, body: `${a.body}\n\n_Opened by the Flowstate business agent._` });
    if (prRes.status === 422) {
      const existing = (await readJson(await gh('GET', `/pulls?head=${owner}:${encodeURIComponent(branch)}&state=open`), 'GitHub')) as Array<{ html_url: string }>;
      if (existing[0]) return { ok: true, content: `Pull request already open: ${existing[0].html_url}`, stateChange: false };
    }
    const pr = (await readJson(prRes, 'GitHub')) as { html_url: string; number: number };
    return { ok: true, content: `Opened PR #${pr.number}: ${pr.html_url}`, stateChange: true, data: pr };
  },
};

const deployArgs = z.object({ reason: z.string().min(10).max(1_000) });

export const deployTrigger: Skill<z.infer<typeof deployArgs>> = {
  key: 'deploy.trigger',
  toolName: skillToolName('deploy.trigger'),
  name: 'Trigger a deploy',
  description:
    "Call the owner's deploy hook (Vercel / Netlify / Render) to ship what is on the deploy branch. Always requires the owner's approval.",
  parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
  schema: deployArgs,
  category: 'deploy',
  risk: 'high',
  costCredits: 1,
  channel: 'code',
  providers: ['deploy_hook'],
  rubric: ['The change being deployed was reviewed and merged'],
  failureConditions: ['Hook URL invalid', 'Deploy provider rejected the request'],
  preview: (a) => ({ title: 'Deploy to production', summary: a.reason }),
  async execute(ctx) {
    const cred = ctx.credentials.resolve('deploy_hook');
    if (!cred) return { ok: false, content: 'ERROR: no deploy hook connected' };
    const url = cred.secret.reveal();
    if (!url.startsWith('https://')) return { ok: false, content: 'ERROR: deploy hook must be https' };
    const res = await ctx.fetch(url, { method: 'POST' });
    if (!res.ok) await readJson(res, 'Deploy hook');
    return { ok: true, content: `Deploy triggered (HTTP ${res.status}).`, stateChange: true };
  },
};

export const CODE_SKILLS: Skill[] = [githubOpenPr, deployTrigger];
