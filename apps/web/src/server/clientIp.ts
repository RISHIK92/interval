import { isIPv6 } from "node:net";

// P3-W13-S07: the visitor's address, for the guest limit. Each of our proxies adds the
// address it was called from to the right of X-Forwarded-For; anything left of those
// came from the client and can be made up. With no proxy in front (local), everyone is
// one network; a header shorter than our proxies (a misconfiguration) is one too.
export function clientIp(headers: Headers, trustedProxies: number): string {
  if (trustedProxies === 0) return "local";
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop !== "");
  const ip = hops.at(-trustedProxies);
  return ip === undefined ? "unknown" : network(ip);
}

// One home or phone gets an IPv6 /64 and picks new addresses in it at will, so the /64
// is the network. An IPv4 address written as IPv6 (::ffff:a.b.c.d) is that address.
function network(ip: string): string {
  if (!isIPv6(ip)) return ip;
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1] !== undefined) return mapped[1];
  const [head = "", tail = ""] = lower.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === "" ? [] : tail.split(":");
  const groups = lower.includes("::")
    ? [
        ...left,
        ...Array<string>(8 - left.length - right.length).fill("0"),
        ...right,
      ]
    : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}
