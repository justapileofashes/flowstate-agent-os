import { supabaseAdmin } from '@/lib/supabase-admin';
import { shapeRelease, type ReleaseRow } from '@/lib/releases';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('releases')
    .select('version, notes, setup_url, portable_url, pub_date')
    .order('pub_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[latest] query failed:', error.message);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
  if (!data) return Response.json({ error: 'no_release' }, { status: 404 });

  return Response.json(shapeRelease(data as ReleaseRow), {
    headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
  });
}
