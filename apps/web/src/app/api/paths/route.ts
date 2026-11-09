import type { PathsResponse } from "@interval/api-client";
import { paths } from "../../../server/container";
import { pathReader } from "../../../server/path-routes";

export const dynamic = "force-dynamic";

// P4-W21-S03 (§5F): the live paths, the user's active one among them.
export async function GET(request: Request): Promise<Response> {
  const context = await pathReader(request);
  if (context instanceof Response) return context;
  const live = await paths().live(context.userId);
  const body: PathsResponse = {
    paths: live.map((p) => ({
      pathId: p.pathId,
      name: p.name,
      why: p.why,
      sections: p.sections,
      readings: p.readings,
      minutes: p.minutes,
      mine: p.mine,
      retired: p.retired,
    })),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
