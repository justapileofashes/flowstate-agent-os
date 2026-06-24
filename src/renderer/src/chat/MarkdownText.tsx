import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useState } from 'react';

interface Props {
  children: string;
}

/** Detect filename from a fenced code block's info string (e.g.
 *  ```ts:src/foo.ts or ```html title="page.html") and pick a sensible
 *  default extension when none is provided. */
function inferFilename(language: string | undefined, body: string): string {
  if (!language) return guessExt(body);
  // Common patterns the model uses to name a file in the fence:
  //   ```ts:src/foo.ts
  //   ```html title="page.html"
  //   ```python file=app.py
  const colon = language.match(/:([^\s]+)$/);
  if (colon) return colon[1]!;
  const titleAttr = language.match(/(?:title|file|name|filename)=["']?([^\s"']+)["']?/i);
  if (titleAttr) return titleAttr[1]!;
  const langOnly = language.split(/\s+/)[0]?.toLowerCase() ?? '';
  const ext = EXT_MAP[langOnly] ?? langOnly ?? 'txt';
  const slug = (body.split('\n')[0] ?? 'snippet')
    .replace(/[^a-z0-9-_]+/gi, '_')
    .slice(0, 24) || 'snippet';
  return `${slug}.${ext}`;
}

function guessExt(body: string): string {
  if (/^\s*<!DOCTYPE html|<html[ >]/i.test(body)) return 'snippet.html';
  if (/^\s*<\?xml|<svg[ >]/i.test(body)) return 'snippet.svg';
  if (/^\s*\{[\s\S]*\}\s*$/.test(body)) return 'snippet.json';
  return 'snippet.txt';
}

const EXT_MAP: Record<string, string> = {
  js: 'js', javascript: 'js',
  ts: 'ts', typescript: 'ts',
  tsx: 'tsx', jsx: 'jsx',
  py: 'py', python: 'py',
  rb: 'rb', ruby: 'rb',
  go: 'go', golang: 'go',
  rs: 'rs', rust: 'rs',
  java: 'java',
  kt: 'kt', kotlin: 'kt',
  swift: 'swift',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', cxx: 'cpp',
  cs: 'cs', csharp: 'cs',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh',
  ps1: 'ps1', powershell: 'ps1',
  sql: 'sql',
  html: 'html', svg: 'svg',
  css: 'css', scss: 'scss',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'md', markdown: 'md',
  xml: 'xml',
  dockerfile: 'Dockerfile',
};

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}): JSX.Element {
  // rehype-highlight tags code with `language-X hljs` classes. Strip to raw language token.
  const langMatch = (className ?? '').match(/language-([^\s]+)/);
  const language = langMatch?.[1];
  const body = String(children ?? '').replace(/\n$/, '');
  const filename = inferFilename(language, body);
  const [copied, setCopied] = useState(false);

  async function copyAll(): Promise<void> {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // best-effort
    }
  }

  function saveAs(): void {
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="codeblock" style={{ position: 'relative' }}>
      <div className="codeblock-head">
        <span className="mono">{filename}</span>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          {language ? <span className="mono">{language}</span> : null}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ height: 18, padding: '0 6px', fontSize: 10 }}
            onClick={() => void copyAll()}
            title="Copy to clipboard"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ height: 18, padding: '0 6px', fontSize: 10 }}
            onClick={saveAs}
            title={`Save as ${filename}`}
          >
            Save
          </button>
        </span>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export function MarkdownText({ children }: Props): JSX.Element {
  return (
    <div className="markdown text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
          // Wrap fenced code blocks with a "Save as file" button.
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const isBlock = typeof className === 'string' && className.startsWith('language-');
            if (isBlock) {
              return <CodeBlock className={className}>{children as React.ReactNode}</CodeBlock>;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
