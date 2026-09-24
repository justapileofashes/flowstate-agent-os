// Run replay (spec §15 / Phase 9): rebuild a readable narrative and the
// state of a run at any historical step from its run_steps. Answers, post
// hoc: what did it believe the goal was, what did it plan, which tools did
// it call with what (redacted) args and results, why did it stop, and what
// did it cost.

import type { ReplayStateDto, RunDto, StepDto, StopReason } from '@shared/business/types';

function firstLine(s: string | null, max = 240): string {
  if (!s) return '';
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function narrate(step: StepDto): string {
  switch (step.phase) {
    case 'perceive':
      return `Perceived: ${firstLine(step.content)}`;
    case 'plan':
      return `Planned: ${firstLine(step.content)}`;
    case 'reason':
      return `Thought (${step.model ?? 'model'}, ${step.tokensIn}+${step.tokensOut} tok, ${step.credits.toFixed(2)} cr): ${firstLine(step.content)}`;
    case 'act':
      if (step.stepKind === 'approval') return `Queued ${step.toolName} for approval — ${firstLine(step.content, 160)}`;
      if (step.stepKind === 'guardrail') return `Blocked ${step.toolName}: ${firstLine(step.toolResultRedacted, 200)}`;
      return `Called ${step.toolName} → ${step.ok ? 'ok' : 'failed'}: ${firstLine(step.toolResultRedacted, 200)}`;
    case 'observe':
      return step.stepKind === 'goal_check' ? `Goal check: ${firstLine(step.content)}` : `Observed: ${firstLine(step.content)}`;
    case 'stop':
      return `Stopped — ${firstLine(step.content)}`;
    default:
      return firstLine(step.content);
  }
}

export function buildReplay(run: RunDto, steps: StepDto[], uptoSeq?: number): ReplayStateDto {
  const upto = uptoSeq ?? (steps.length ? steps[steps.length - 1]!.seqNo : 0);
  const visible = steps.filter((s) => s.seqNo <= upto);
  const stopStep = visible.find((s) => s.phase === 'stop');
  return {
    runId: run.id,
    uptoSeq: upto,
    totalSteps: steps.length,
    narrative: [
      { seqNo: 0, phase: 'perceive', text: `Goal: ${firstLine(run.goal, 400)}` },
      ...visible.map((s) => ({ seqNo: s.seqNo, phase: s.phase, text: narrate(s) })),
    ],
    toolCalls: visible
      .filter((s) => s.phase === 'act')
      .map((s) => ({
        seqNo: s.seqNo,
        tool: s.toolName ?? '?',
        args: s.toolArgsRedacted ?? '',
        result: s.toolResultRedacted ?? '',
        ok: s.ok,
      })),
    creditsSoFar: Math.round(visible.reduce((a, s) => a + s.credits, 0) * 10_000) / 10_000,
    costSoFar: visible.reduce((a, s) => a + s.costUsd, 0),
    stopReason: stopStep ? ((run.stopReason ?? null) as StopReason | null) : null,
  };
}
