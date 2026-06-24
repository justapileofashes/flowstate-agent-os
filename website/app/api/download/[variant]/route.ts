import { supabaseAdmin } from '@/lib/supabase-admin';
import { isVariant } from '@/lib/download';
import { badRequest } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ variant: string }> },
): Promise<Response> {
  const { variant } = await ctx.params;
  if (!isVariant(variant)) return badRequest('unknown variant');

  const db = supabaseAdmin();
  const { data, error } = await db
    .from('releases')
    .select('setup_url, portable_url')
    .order('pub_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return Response.json({ error: 'no_release' }, { status: 404 });

  // Best-effort count — must never block the download.
  void db.rpc('increment_download', { p_variant: variant }).then(({ error: e }) => {
    if (e) console.error('[download] count failed:', e.message);
  });

  const url = variant === 'setup' ? data.setup_url : data.portable_url;
  return Response.redirect(url, 302);
}
