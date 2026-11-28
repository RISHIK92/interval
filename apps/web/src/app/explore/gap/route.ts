import { cookies } from "next/headers";
import { z } from "zod";
import { events, explore, sessionReader } from "../../../server/container";
import { outHref } from "../../../server/outbound";
import { BIGINT_ID } from "../../../server/ports";
import { visitId } from "../../../server/visits";

export const dynamic = "force-dynamic";

const Gap = z.object({ concept: z.string().regex(BIGINT_ID) });

function explorePage(): Response {
  return new Response(null, { status: 302, headers: { location: "/explore" } });
}

// ADR-0046: "Close the gap" counts its open, then goes to the gap's shortest article
// (ADR-0058) through /out, as every reading link does. The gap is worked out again here, so a
// link can only ever open the user's own current gap.
export async function GET(request: Request): Promise<Response> {
  const parsed = Gap.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return explorePage();
  const actor = await sessionReader().current(request.headers);
  if (actor === null || actor.isGuest) return explorePage();
  const gap = await explore().gap(actor.userId);
  if (gap?.conceptId !== parsed.data.concept) return explorePage();
  events().emit(
    "gap_opened",
    { concept_id: gap.conceptId },
    { ...actor, sessionId: visitId(await cookies()) },
  );
  return new Response(null, {
    status: 302,
    headers: {
      location: outHref({
        itemId: gap.itemId,
        from: "explore",
        target: "article",
      }),
    },
  });
}
