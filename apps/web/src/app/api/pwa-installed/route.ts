import { cookies } from "next/headers";
import { events, sessionReader } from "../../../server/container";
import { visitId } from "../../../server/visits";
import { env } from "../../../env";

export const dynamic = "force-dynamic";

// pwa_installed (P1-W5-S06), posted by PwaSetup on the browser's appinstalled event.
// Same origin only, so another site can't count installs for a signed-in reader.
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("origin") !== new URL(env().BETTER_AUTH_URL).origin) {
    return new Response(null, { status: 403 });
  }
  const actor = await sessionReader().current(request.headers);
  if (actor !== null) {
    events().emit(
      "pwa_installed",
      {},
      { ...actor, sessionId: visitId(await cookies()) },
    );
  }
  return new Response(null, { status: 204 });
}
