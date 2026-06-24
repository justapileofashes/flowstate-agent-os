// Detects local hardware for model-fit recommendations.
// - CPU model + core count from os.cpus()
// - Total RAM from os.totalmem()
// - GPU VRAM via nvidia-smi (NVIDIA) with WMI fallback for Intel/AMD
//   (Windows-only fallback path, since the app ships Windows-only).

import os from 'node:os';
import { execFile } from 'node:child_process';

export interface GpuInfo {
  name: string;
  vramMB: number;
  vendor: 'nvidia' | 'amd' | 'intel' | 'other';
  /** Installed driver version, when the source reports it. */
  driverVersion?: string;
}

/** Rich CPU spec read live from the OS (Windows WMI). */
export interface CpuSpec {
  model: string;
  physicalCores: number;
  logicalCores: number;
  maxClockMHz: number;
  l2CacheKB: number;
  l3CacheKB: number;
}

/** One installed RAM stick, read live from the OS (Windows WMI). */
export interface RamModule {
  capacityGB: number;
  speedMHz: number;
  /** DDR3 / DDR4 / DDR5 / … */
  type: string;
  manufacturer: string;
  partNumber: string;
  /** Physical slot label, e.g. "DIMM0". */
  slot: string;
}

export interface HardwareInfo {
  platform: string;
  cpuModel: string;
  cpuCount: number;
  ramGB: number;
  gpus: GpuInfo[];
  /** Best-effort effective VRAM (largest single discrete GPU). */
  primaryVramGB: number;
  /**
   * Inference-speed multiplier for THIS machine relative to the reference GPU
   * the catalog speeds are calibrated against (RTX 4070 Ti Super = 1.0).
   * Derived from the detected primary GPU's memory bandwidth, since
   * fully-offloaded LLM decode speed is roughly bandwidth-bound. 1.0 when no
   * GPU is detected (estimates fall back to the reference baseline).
   */
  perfFactor: number;
  /** Full CPU spec from the OS (Windows only; undefined elsewhere/on failure). */
  cpu?: CpuSpec;
  /** Installed RAM sticks from the OS (Windows only; empty elsewhere/on failure). */
  ramModules?: RamModule[];
  detectionNotes: string[];
}

/** Memory bandwidth (GB/s) of the GPU the catalog speeds are calibrated to. */
export const REFERENCE_BANDWIDTH_GBS = 672; // RTX 4070 Ti Super

// Memory bandwidth (GB/s) for common GPUs. Decode tok/s on a fully-offloaded
// model tracks bandwidth closely, so this is a far better speed proxy than a
// single hardcoded number. Keyed by a substring of the GPU name; ORDER MATTERS
// — more specific keys first ('4070 ti super' before '4070 ti' before '4070').
const GPU_BANDWIDTH_GBS: Array<[match: string, gbs: number]> = [
  // NVIDIA RTX 50
  ['5090', 1792],
  ['5080', 960],
  ['5070 ti', 896],
  ['5070', 672],
  // NVIDIA RTX 40
  ['4090', 1008],
  ['4080 super', 736],
  ['4080', 717],
  ['4070 ti super', 672],
  ['4070 ti', 504],
  ['4070 super', 504],
  ['4070', 504],
  ['4060 ti', 288],
  ['4060', 272],
  // NVIDIA RTX 30
  ['3090 ti', 1008],
  ['3090', 936],
  ['3080 ti', 912],
  ['3080', 760],
  ['3070 ti', 608],
  ['3070', 448],
  ['3060 ti', 448],
  ['3060', 360],
  // NVIDIA RTX 20 / GTX 16
  ['2080 ti', 616],
  ['2080', 448],
  ['2070', 448],
  ['2060', 336],
  ['1660', 192],
  ['1650', 192],
  // NVIDIA datacenter / pro
  ['h100', 3350],
  ['a100', 1555],
  ['a6000', 768],
  ['a5000', 768],
  ['a4000', 448],
  ['t4', 320],
  // AMD Radeon
  ['7900 xtx', 960],
  ['7900 xt', 800],
  ['7800 xt', 624],
  ['7700 xt', 432],
  ['7600', 288],
  ['6950 xt', 576],
  ['6900 xt', 512],
  ['6800 xt', 512],
  ['6800', 512],
  ['6700 xt', 384],
  ['6600', 224],
];

/**
 * Estimate a GPU's memory bandwidth in GB/s. Exact when the model is in the
 * table; otherwise a VRAM-based heuristic (discrete cards roughly scale
 * bandwidth with capacity). Integrated/unknown get a low shared-memory figure.
 */
export function estimateGpuBandwidthGBs(gpu: GpuInfo): number {
  const name = gpu.name.toLowerCase();
  for (const [match, gbs] of GPU_BANDWIDTH_GBS) {
    if (name.includes(match)) return gbs;
  }
  // Unknown model — fall back to a capacity heuristic from the detected VRAM.
  const vramGB = gpu.vramMB / 1024;
  if (gpu.vendor === 'nvidia' || gpu.vendor === 'amd') {
    return Math.max(100, Math.round(vramGB * 42)); // ~16GB → ~672 GB/s
  }
  // Integrated (Intel) or other — shared system memory, much slower.
  return 80;
}

/** Speed multiplier vs the reference GPU, clamped to a sane range. */
function perfFactorFor(primaryGpu: GpuInfo | undefined): number {
  if (!primaryGpu) return 1.0;
  const bw = estimateGpuBandwidthGBs(primaryGpu);
  const factor = bw / REFERENCE_BANDWIDTH_GBS;
  return Math.round(Math.max(0.1, Math.min(4, factor)) * 100) / 100;
}

function execFileP(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; ok: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const child = execFile(
      cmd,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (settled) return;
        settled = true;
        if (err) resolve({ stdout: '', ok: false });
        else resolve({ stdout: String(stdout), ok: true });
      },
    );
    child.on('error', () => {
      if (settled) return;
      settled = true;
      resolve({ stdout: '', ok: false });
    });
  });
}

async function detectNvidia(): Promise<GpuInfo[]> {
  const res = await execFileP(
    'nvidia-smi',
    ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
    4000,
  );
  if (!res.ok || res.stdout.trim().length === 0) return [];
  return res.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.split(',').map((s) => s.trim());
      const name = parts[0] ?? 'NVIDIA GPU';
      const vramMB = parseInt(parts[1] ?? '0', 10);
      const driverVersion = parts[2] || undefined;
      const g: GpuInfo = {
        name,
        vramMB: Number.isFinite(vramMB) ? vramMB : 0,
        vendor: 'nvidia' as const,
      };
      if (driverVersion) g.driverVersion = driverVersion;
      return g;
    })
    .filter((g) => g.vramMB > 0);
}

async function detectWMI(): Promise<GpuInfo[]> {
  // PowerShell + CIM works on Win10+. AdapterRAM is uint32 so caps at 4GB —
  // that's accurate enough to detect integrated/low-VRAM cards. NVIDIA
  // already covered by nvidia-smi above.
  const ps =
    'Get-CimInstance Win32_VideoController | ' +
    'Select-Object Name, AdapterRAM, DriverVersion | ConvertTo-Json -Compress';
  const res = await execFileP('powershell', ['-NoProfile', '-Command', ps], 5000);
  if (!res.ok) return [];
  try {
    const trimmed = res.stdout.trim();
    if (trimmed.length === 0) return [];
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .map((entry: unknown) => {
        const o = entry as { Name?: unknown; AdapterRAM?: unknown; DriverVersion?: unknown };
        const name = typeof o.Name === 'string' ? o.Name : 'Unknown GPU';
        const adapterRam = Number(o.AdapterRAM ?? 0);
        const vramMB = Math.round(adapterRam / 1024 / 1024);
        const lower = name.toLowerCase();
        const vendor: GpuInfo['vendor'] = lower.includes('nvidia')
          ? 'nvidia'
          : lower.includes('amd') || lower.includes('radeon')
            ? 'amd'
            : lower.includes('intel')
              ? 'intel'
              : 'other';
        const g: GpuInfo = { name, vramMB, vendor };
        if (typeof o.DriverVersion === 'string' && o.DriverVersion.trim()) {
          g.driverVersion = o.DriverVersion.trim();
        }
        return g;
      })
      .filter((g: GpuInfo) => g.vramMB > 0);
  } catch {
    return [];
  }
}

// SMBIOS memory-type code → human label (Win32_PhysicalMemory.SMBIOSMemoryType).
const SMBIOS_MEM_TYPE: Record<number, string> = {
  20: 'DDR',
  21: 'DDR2',
  22: 'DDR2 FB-DIMM',
  24: 'DDR3',
  26: 'DDR4',
  34: 'DDR5',
  35: 'DDR5',
};

/** Full CPU spec via WMI (Windows). Sums cores/cache across sockets. */
async function detectCpuSpecsWMI(): Promise<CpuSpec | null> {
  const ps =
    'Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,' +
    'NumberOfLogicalProcessors,MaxClockSpeed,L2CacheSize,L3CacheSize | ConvertTo-Json -Compress';
  const res = await execFileP('powershell', ['-NoProfile', '-Command', ps], 6000);
  if (!res.ok) return null;
  try {
    const trimmed = res.stdout.trim();
    if (!trimmed) return null;
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (arr.length === 0) return null;
    let model = '';
    let physical = 0;
    let logical = 0;
    let maxClock = 0;
    let l2 = 0;
    let l3 = 0;
    for (const entry of arr) {
      const o = entry as Record<string, unknown>;
      if (!model && typeof o.Name === 'string') model = o.Name.trim();
      physical += Number(o.NumberOfCores ?? 0);
      logical += Number(o.NumberOfLogicalProcessors ?? 0);
      maxClock = Math.max(maxClock, Number(o.MaxClockSpeed ?? 0));
      l2 += Number(o.L2CacheSize ?? 0);
      l3 += Number(o.L3CacheSize ?? 0);
    }
    return {
      model: model || 'Unknown CPU',
      physicalCores: physical,
      logicalCores: logical,
      maxClockMHz: maxClock,
      l2CacheKB: l2,
      l3CacheKB: l3,
    };
  } catch {
    return null;
  }
}

/** Installed RAM sticks via WMI (Windows). */
async function detectRamModulesWMI(): Promise<RamModule[]> {
  const ps =
    'Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,Speed,' +
    'ConfiguredClockSpeed,SMBIOSMemoryType,Manufacturer,PartNumber,DeviceLocator | ConvertTo-Json -Compress';
  const res = await execFileP('powershell', ['-NoProfile', '-Command', ps], 6000);
  if (!res.ok) return [];
  try {
    const trimmed = res.stdout.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .map((entry: unknown): RamModule => {
        const o = entry as Record<string, unknown>;
        const capBytes = Number(o.Capacity ?? 0);
        const speed = Number(o.ConfiguredClockSpeed ?? 0) || Number(o.Speed ?? 0);
        const t = Number(o.SMBIOSMemoryType ?? 0);
        return {
          capacityGB: Math.round((capBytes / 1024 / 1024 / 1024) * 10) / 10,
          speedMHz: speed,
          type: SMBIOS_MEM_TYPE[t] ?? (t ? `type ${t}` : 'unknown'),
          manufacturer: (typeof o.Manufacturer === 'string' && o.Manufacturer.trim()) || '—',
          partNumber: (typeof o.PartNumber === 'string' && o.PartNumber.trim()) || '—',
          slot: (typeof o.DeviceLocator === 'string' && o.DeviceLocator.trim()) || '—',
        };
      })
      .filter((m) => m.capacityGB > 0);
  } catch {
    return [];
  }
}

// ── macOS detection (sysctl / system_profiler) ────────────────────────────
async function sysctl(key: string): Promise<string> {
  const r = await execFileP('sysctl', ['-n', key], 3000);
  return r.ok ? r.stdout.trim() : '';
}

async function detectCpuMac(): Promise<Partial<CpuSpec>> {
  const [brand, phys, log, l2, l3, freq] = await Promise.all([
    sysctl('machdep.cpu.brand_string'),
    sysctl('hw.physicalcpu'),
    sysctl('hw.logicalcpu'),
    sysctl('hw.l2cachesize'),
    sysctl('hw.l3cachesize'),
    sysctl('hw.cpufrequency_max'),
  ]);
  const out: Partial<CpuSpec> = {};
  if (brand) out.model = brand;
  if (Number(phys) > 0) out.physicalCores = Number(phys);
  if (Number(log) > 0) out.logicalCores = Number(log);
  if (Number(l2) > 0) out.l2CacheKB = Math.round(Number(l2) / 1024);
  if (Number(l3) > 0) out.l3CacheKB = Math.round(Number(l3) / 1024);
  if (Number(freq) > 0) out.maxClockMHz = Math.round(Number(freq) / 1e6);
  return out;
}

async function detectRamMac(): Promise<RamModule[]> {
  const r = await execFileP('system_profiler', ['SPMemoryDataType', '-json'], 8000);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(r.stdout.trim()) as { SPMemoryDataType?: unknown };
    const top = Array.isArray(parsed.SPMemoryDataType) ? parsed.SPMemoryDataType : [];
    const out: RamModule[] = [];
    for (const node of top) {
      const o = node as Record<string, unknown>;
      // Intel Macs nest individual DIMMs under `_items`; Apple Silicon reports
      // a single unified-memory node.
      const items = Array.isArray(o['_items']) ? (o['_items'] as unknown[]) : [o];
      for (const it of items) {
        const m = it as Record<string, unknown>;
        const sizeStr = String(m['dimm_size'] ?? m['SPMemoryDataType'] ?? '');
        const gb = /(\d+(?:\.\d+)?)\s*GB/i.exec(sizeStr);
        if (!gb) continue;
        const speed = /(\d+)\s*MHz/i.exec(String(m['dimm_speed'] ?? ''));
        out.push({
          capacityGB: Number(gb[1]),
          speedMHz: speed ? Number(speed[1]) : 0,
          type: String(m['dimm_type'] ?? 'unknown').trim() || 'unknown',
          manufacturer: String(m['dimm_manufacturer'] ?? '—').trim() || '—',
          partNumber: String(m['dimm_part_number'] ?? '—').trim() || '—',
          slot: String(m['_name'] ?? 'memory').trim() || 'memory',
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function detectGpuMac(): Promise<GpuInfo[]> {
  const r = await execFileP('system_profiler', ['SPDisplaysDataType', '-json'], 8000);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(r.stdout.trim()) as { SPDisplaysDataType?: unknown };
    const arr = Array.isArray(parsed.SPDisplaysDataType) ? parsed.SPDisplaysDataType : [];
    return arr
      .map((node): GpuInfo => {
        const o = node as Record<string, unknown>;
        const name = String(o['sppci_model'] ?? o['_name'] ?? 'GPU').trim();
        const vramStr = String(o['spdisplays_vram'] ?? o['spdisplays_vram_shared'] ?? '');
        const gb = /(\d+(?:\.\d+)?)\s*GB/i.exec(vramStr);
        const lower = name.toLowerCase();
        const vendor: GpuInfo['vendor'] = lower.includes('nvidia')
          ? 'nvidia'
          : lower.includes('amd') || lower.includes('radeon')
            ? 'amd'
            : lower.includes('intel') || lower.includes('apple')
              ? 'intel'
              : 'other';
        return { name, vramMB: gb ? Math.round(Number(gb[1]) * 1024) : 0, vendor };
      })
      .filter((g) => g.name && g.name !== 'GPU');
  } catch {
    return [];
  }
}

// ── Linux detection (lscpu / lspci) ────────────────────────────────────────
function parseCacheToKB(s: string): number {
  const m = /([\d.]+)\s*(KiB|KB|MiB|MB|GiB|GB)/i.exec(s);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (unit.startsWith('g')) return Math.round(n * 1024 * 1024);
  if (unit.startsWith('m')) return Math.round(n * 1024);
  return Math.round(n);
}

async function detectCpuLinux(): Promise<Partial<CpuSpec>> {
  const r = await execFileP('lscpu', [], 3000);
  if (!r.ok) return {};
  const map: Record<string, string> = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const out: Partial<CpuSpec> = {};
  if (map['Model name']) out.model = map['Model name'];
  const sockets = Number(map['Socket(s)'] || 1) || 1;
  const coresPer = Number(map['Core(s) per socket'] || 0);
  if (coresPer > 0) out.physicalCores = sockets * coresPer;
  const maxMHz = Number(map['CPU max MHz'] || 0);
  if (maxMHz > 0) out.maxClockMHz = Math.round(maxMHz);
  if (map['L2 cache']) out.l2CacheKB = parseCacheToKB(map['L2 cache']);
  if (map['L3 cache']) out.l3CacheKB = parseCacheToKB(map['L3 cache']);
  return out;
}

async function detectGpuLinux(): Promise<GpuInfo[]> {
  const r = await execFileP('lspci', [], 4000);
  if (!r.ok) return [];
  const out: GpuInfo[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!/VGA compatible controller|3D controller|Display controller/i.test(line)) continue;
    const name = line.replace(/^.*?:\s*(VGA compatible controller|3D controller|Display controller):\s*/i, '').trim();
    const lower = name.toLowerCase();
    const vendor: GpuInfo['vendor'] = lower.includes('nvidia')
      ? 'nvidia'
      : lower.includes('amd') || lower.includes('radeon') || lower.includes('ati')
        ? 'amd'
        : lower.includes('intel')
          ? 'intel'
          : 'other';
    // lspci does not report VRAM; nvidia-smi already covers NVIDIA cards with it.
    out.push({ name: name || 'GPU', vramMB: 0, vendor });
  }
  return out;
}

export async function detectHardware(): Promise<HardwareInfo> {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() ?? 'Unknown CPU';
  const cpuCount = cpus.length;
  const ramGB = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10;
  const notes: string[] = [];

  // GPUs: nvidia-smi works on every OS; fall back to the platform's own probe.
  let gpus = await detectNvidia();
  if (gpus.length === 0) {
    if (process.platform === 'win32') gpus = await detectWMI();
    else if (process.platform === 'darwin') gpus = await detectGpuMac();
    else if (process.platform === 'linux') gpus = await detectGpuLinux();
    if (gpus.length === 0) {
      notes.push(
        'GPU detection failed — recommendations will be based on RAM only. Models will run on CPU (slower).',
      );
    }
  }

  // CPU spec: an os.cpus() baseline (cross-platform), enriched with exact
  // physical-core / cache / clock figures from the platform's own tools.
  let cpu: CpuSpec = {
    model: cpuModel,
    physicalCores: 0,
    logicalCores: cpuCount,
    maxClockMHz: cpus[0]?.speed ?? 0,
    l2CacheKB: 0,
    l3CacheKB: 0,
  };
  let ramModules: RamModule[] = [];
  if (process.platform === 'win32') {
    const [w, mods] = await Promise.all([detectCpuSpecsWMI(), detectRamModulesWMI()]);
    if (w) cpu = w;
    ramModules = mods;
  } else if (process.platform === 'darwin') {
    const [enrich, mods] = await Promise.all([detectCpuMac(), detectRamMac()]);
    cpu = { ...cpu, ...enrich };
    ramModules = mods;
  } else if (process.platform === 'linux') {
    cpu = { ...cpu, ...(await detectCpuLinux()) };
    // Per-module RAM on Linux needs root (dmidecode) — skip; total RAM still shown.
  }

  // Pick the largest discrete GPU as "primary". Skip integrated when a
  // discrete card is present (NVIDIA detection wins on dual-GPU systems).
  const discrete = gpus.filter((g) => g.vendor === 'nvidia' || g.vendor === 'amd');
  const primary = discrete.length > 0 ? discrete : gpus;
  const primaryGpu =
    primary.length > 0
      ? primary.reduce((a, b) => (b.vramMB > a.vramMB ? b : a))
      : undefined;
  const primaryVramGB = primaryGpu ? Math.round((primaryGpu.vramMB / 1024) * 10) / 10 : 0;
  const perfFactor = perfFactorFor(primaryGpu);

  return {
    platform: process.platform,
    cpuModel,
    cpuCount,
    ramGB,
    gpus,
    primaryVramGB,
    perfFactor,
    cpu,
    ...(ramModules.length > 0 ? { ramModules } : {}),
    detectionNotes: notes,
  };
}
