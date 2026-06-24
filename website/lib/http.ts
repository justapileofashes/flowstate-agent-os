export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export function badRequest(message = 'bad request'): Response {
  return Response.json({ error: message }, { status: 400 });
}

export function tooMany(): Response {
  return Response.json({ error: 'rate_limited' }, { status: 429 });
}
