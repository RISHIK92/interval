import { checkHealth } from "../../../server/health";
import { db } from "../../../server/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { status, httpStatus } = await checkHealth(db());
  return Response.json(
    { status },
    { status: httpStatus, headers: { "cache-control": "no-store" } },
  );
}
