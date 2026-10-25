import { trace } from "@opentelemetry/api";
import { databasePing } from "../../../server/container";
import { checkHealth } from "../../../server/health";

export const dynamic = "force-dynamic";

const tracer = trace.getTracer("interval-web");

// A caller's x-request-id (a test, an uptime probe) is kept only when short and plain;
// nothing in front of the app sets it, so anything else gets a fresh id.
const REQUEST_ID = /^[\w.-]{1,128}$/;

// OPS-2: one span per health request, carrying its request id.
export async function GET(request: Request): Promise<Response> {
  const sent = request.headers.get("x-request-id");
  const requestId =
    sent !== null && REQUEST_ID.test(sent) ? sent : crypto.randomUUID();
  return tracer.startActiveSpan("health.check", async (span) => {
    span.setAttribute("request_id", requestId);
    try {
      const { status, httpStatus } = await checkHealth(databasePing());
      return Response.json(
        { status },
        { status: httpStatus, headers: { "cache-control": "no-store" } },
      );
    } finally {
      span.end();
    }
  });
}
