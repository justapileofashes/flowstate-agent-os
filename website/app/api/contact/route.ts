import { contactSchema } from '@/lib/validate';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp, badRequest, tooMany } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`${clientIp(req)}:contact`, 3, 60_000)) return tooMany();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('invalid json');
  }
  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) return badRequest('invalid input');

  const { name, email, message, website } = parsed.data;
  // Honeypot: real users never fill `website`. Pretend success, store nothing.
  if (website && website.trim().length > 0) return Response.json({ ok: true });

  const db = supabaseAdmin();
  const { error } = await db.from('contacts').insert({ name, email, message });
  if (error) {
    console.error('[contact] insert failed:', error.message);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
  return Response.json({ ok: true });
}
