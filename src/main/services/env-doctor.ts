// Environment doctor — a one-click "is my setup healthy?" report. Vibe devs
// love a `doctor` command that tells them exactly what's wrong (Ollama down, no
// models pulled, disk nearly full, no cloud key) and how to fix it. Pure
// aggregator: the handler gathers the raw probe values via existing services,
// this turns them into a prioritized, human-readable checklist.

export interface DoctorProbes {
  ollamaReachable: boolean;
  modelsInstalled: number;
  cloudKeysConfigured: number;
  diskFreeGB: number | null;
  workspacesWritable: boolean;
  gpuPresent: boolean;
}

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  /** Actionable fix shown when status isn't pass. */
  hint?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** Worst status across all checks — drives the summary badge. */
  overall: DoctorStatus;
}

const LOW_DISK_GB = 5;

export function runDoctor(p: DoctorProbes): DoctorReport {
  const checks: DoctorCheck[] = [];

  checks.push(
    p.ollamaReachable
      ? { id: 'ollama', label: 'Ollama runtime', status: 'pass', detail: 'Reachable.' }
      : {
          id: 'ollama',
          label: 'Ollama runtime',
          status: 'fail',
          detail: 'Not reachable.',
          hint: 'Install from ollama.com and run `ollama serve`, then re-check.',
        },
  );

  const hasAnyModel = p.modelsInstalled > 0;
  const hasCloud = p.cloudKeysConfigured > 0;
  checks.push(
    hasAnyModel
      ? {
          id: 'models',
          label: 'Local models',
          status: 'pass',
          detail: `${p.modelsInstalled} installed.`,
        }
      : {
          id: 'models',
          label: 'Local models',
          status: hasCloud ? 'warn' : 'fail',
          detail: 'No local models pulled.',
          hint: hasCloud
            ? 'Cloud keys are set, so you can still chat — pull a local model for offline use.'
            : 'Pull one from the Models screen (e.g. `llama3.1`) or add a cloud API key.',
        },
  );

  checks.push({
    id: 'cloud',
    label: 'Cloud providers',
    status: hasCloud ? 'pass' : 'warn',
    detail: hasCloud ? `${p.cloudKeysConfigured} configured.` : 'None configured.',
    hint: hasCloud ? undefined : 'Add an API key in Settings to use Claude / GPT / Gemini.',
  });

  if (p.diskFreeGB !== null) {
    const low = p.diskFreeGB < LOW_DISK_GB;
    checks.push({
      id: 'disk',
      label: 'Disk space',
      status: low ? 'warn' : 'pass',
      detail: `${p.diskFreeGB.toFixed(1)} GB free.`,
      hint: low ? 'Models and snapshots need room — free up space.' : undefined,
    });
  }

  checks.push(
    p.workspacesWritable
      ? { id: 'workspaces', label: 'Workspaces folder', status: 'pass', detail: 'Writable.' }
      : {
          id: 'workspaces',
          label: 'Workspaces folder',
          status: 'fail',
          detail: 'Not writable.',
          hint: 'Pick a writable workspaces root in Settings.',
        },
  );

  checks.push({
    id: 'gpu',
    label: 'GPU acceleration',
    status: p.gpuPresent ? 'pass' : 'warn',
    detail: p.gpuPresent ? 'NVIDIA GPU detected.' : 'No NVIDIA GPU detected.',
    hint: p.gpuPresent ? undefined : 'Models run on CPU — expect slower local inference.',
  });

  return { checks, overall: worst(checks) };
}

function worst(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}
