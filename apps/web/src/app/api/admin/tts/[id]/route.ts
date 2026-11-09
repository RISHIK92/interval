import {
  adminTts,
  entitlements,
  files,
  sessionReader,
} from "../../../../../server/container";
import { BIGINT_ID } from "../../../../../server/ports";

export const dynamic = "force-dynamic";

// P4-W22-S03 (TTS-1): a blind-test voice's audio, for admin.review only (anyone else
// finds nothing, as the admin pages). Not cached: the test is the owner's alone.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await sessionReader().current(request.headers);
  if (
    actor === null ||
    !(await entitlements().can(actor.userId, "admin.review"))
  )
    return new Response(null, { status: 404 });
  const { id } = await params;
  if (!BIGINT_ID.test(id)) return new Response(null, { status: 404 });
  const key = await adminTts().fileKey(id);
  const stored = key === null ? null : await files().get(key);
  if (stored === null || stored === "unchanged")
    return new Response(null, { status: 404 });
  return new Response(stored.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(stored.size === null
        ? {}
        : { "Content-Length": String(stored.size) }),
    },
  });
}
