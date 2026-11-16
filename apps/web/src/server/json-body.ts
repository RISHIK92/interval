// P6-W44: a route's JSON body, refused past `max` bytes before it's parsed: a route
// handler, unlike a server action, has no body limit of its own. Null for one too large
// (by its declared length or what arrived) or not JSON.
export async function jsonBody(
  request: Request,
  max: number,
): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 }> {
  if (Number(request.headers.get("content-length") ?? 0) > max)
    return { ok: false, status: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > max)
    return { ok: false, status: 413 };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}
