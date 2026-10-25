import { databasePing } from "../../../server/container";
import { checkHealth } from "../../../server/health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { status, httpStatus } = await checkHealth(databasePing());
  return Response.json(
    { status },
    { status: httpStatus, headers: { "cache-control": "no-store" } },
  );
}
