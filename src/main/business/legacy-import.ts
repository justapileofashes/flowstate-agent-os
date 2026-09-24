// One-time import of the previous Business autopilot (userData/business/
// profile.json + memory.md) into a company, so existing owners keep their
// profile and memory. The old files are left untouched.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companyConfigSchema, type CompanyConfig } from '@shared/business/types';

export interface LegacyBusiness {
  config: CompanyConfig;
  memory: string;
}

export function readLegacyBusiness(dir: string): LegacyBusiness | null {
  const profilePath = join(dir, 'profile.json');
  if (!existsSync(profilePath)) return null;
  try {
    const p = JSON.parse(readFileSync(profilePath, 'utf8')) as {
      name?: string;
      product?: string;
      audience?: string;
      goals?: string[];
      links?: { site?: string; repo?: string };
      schedule?: { enabled?: boolean; time?: string };
    };
    if (!p.name) return null;
    const time = typeof p.schedule?.time === 'string' && /^\d{2}:\d{2}$/.test(p.schedule.time) ? p.schedule.time : '07:00';
    const config = companyConfigSchema.parse({
      name: p.name.slice(0, 120),
      niche: (p.product ?? '').slice(0, 300),
      valueProp: (p.product ?? '').slice(0, 1000),
      icp: (p.audience ?? '').slice(0, 1500),
      goals: (p.goals ?? []).filter((g) => typeof g === 'string' && g.trim()).slice(0, 10).map((g) => g.slice(0, 300)),
      links: { site: (p.links?.site ?? '').slice(0, 300), repo: (p.links?.repo ?? '').slice(0, 300) },
      schedule: { enabled: p.schedule?.enabled ?? true, morning: time },
      // Existing owners already ran sprints; don't retroactively block them.
      validation: { required: false, status: 'waived' },
    });
    let memory = '';
    try {
      memory = readFileSync(join(dir, 'memory.md'), 'utf8').replace(/^# Business memory\s*/, '').trim();
    } catch {
      memory = '';
    }
    return { config, memory };
  } catch {
    return null;
  }
}
