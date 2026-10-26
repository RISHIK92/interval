import { manifest } from "../../server/manifest";

export function GET(): Response {
  return new Response(JSON.stringify(manifest()), {
    headers: { "content-type": "application/manifest+json" },
  });
}
