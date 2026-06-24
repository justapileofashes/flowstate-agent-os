import fs from 'fs';
import path from 'path';

const root = path.resolve('.');
const src = path.join(root, '.design-src');
const pub = path.join(root, 'public', 'design-v2');
const tr = 'C:/Users/TUF/.claude/projects/D--docs-claude-code-projects-claude-agents-dashboard/84504ed1-e66e-4118-9814-4fd862b6a5f0/tool-results';

// pixel-mascot.jsx persisted directly to a tool-result file
const pm = JSON.parse(fs.readFileSync(path.join(tr, 'toolu_011cKkvdCvrsK7uVZwwm85u9.txt'), 'utf8'));
fs.writeFileSync(path.join(pub, 'pixel-mascot.jsx'), pm.content);

// the rest were staged as single-line JSON blobs
for (const f of ['screens.jsx', 'terminal-panel.jsx', 'devtools-composer.jsx']) {
  const j = JSON.parse(fs.readFileSync(path.join(src, f + '.json'), 'utf8'));
  fs.writeFileSync(path.join(pub, f), j.content);
}

console.log('materialized via JSON.parse:', ['pixel-mascot.jsx', 'screens.jsx', 'terminal-panel.jsx', 'devtools-composer.jsx'].map(f => f + ':' + fs.statSync(path.join(pub, f)).size).join('  '));
