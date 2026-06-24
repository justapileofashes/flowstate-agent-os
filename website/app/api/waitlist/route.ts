import { waitlistSchema } from '@/lib/validate';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp, badRequest, tooMany } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`${clientIp(req)}:waitlist`, 5, 60_000)) return tooMany();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('invalid json');
  }
  const parsed = waitlistSchema.safeParse(body);
  if (!parsed.success) return badRequest('invalid email');

  const { email, source } = parsed.data;
  const db = supabaseAdmin();
  const { error } = await db.from('waitlist').insert({ email, source: source ?? null });
  if (error) {
    // unique_violation → already on the list; treat as success, reveal nothing else.
    if (error.code === '23505') return Response.json({ ok: true, already: true });
    console.error('[waitlist] insert failed:', error.message);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
  return Response.json({ ok: true });
}
