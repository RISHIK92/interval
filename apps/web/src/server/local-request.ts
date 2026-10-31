const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// ADR-0030: a request made on this machine, not through a tunnel (ngrok sends its own
// Host, and the visitor's address in x-forwarded-for even when it rewrites Host). Next
// fills x-forwarded-for from the socket only when the client sent none, so a machine
// on the same network can claim loopback: the owner accepted that (ADR-0030). Never
// in a production build.
export function isLocalRequest(headers: Headers): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const hosts = [headers.get("host"), headers.get("x-forwarded-host")];
  if (hosts[0] === null) return false;
  if (!hosts.every((host) => host === null || LOCAL_HOST.test(host)))
    return false;
  const via = headers.get("x-forwarded-for");
  // Next always sets it; without it this isn't the request Next saw.
  return via !== null && via.split(",").every((ip) => LOOPBACK.has(ip.trim()));
}
