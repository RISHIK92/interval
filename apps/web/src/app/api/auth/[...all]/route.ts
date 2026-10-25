import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../server/container";

// Better Auth's own endpoints (session refresh, sign-out). Resolved per request so
// `next build` does not need a runtime environment.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(auth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(auth()).POST(request);
}
