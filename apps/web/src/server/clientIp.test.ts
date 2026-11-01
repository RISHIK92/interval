import { expect, test } from "vitest";
import { clientIp } from "./clientIp";

// P3-W13-S07: the visitor's address, as our own proxies recorded it. Each proxy adds
// the address it was called from to the right of X-Forwarded-For; anything further
// left came from the client and can be made up.
const forwarded = (value: string) => new Headers({ "x-forwarded-for": value });

test("counts our proxies from the right", () => {
  // VM: Caddy sets the client. AWS: CloudFront adds the viewer, the ALB the edge.
  expect(clientIp(forwarded("203.0.113.5"), 1)).toBe("203.0.113.5");
  expect(clientIp(forwarded("1.1.1.1, 203.0.113.5, 130.176.0.9"), 2)).toBe(
    "203.0.113.5",
  );
  expect(clientIp(forwarded("1.1.1.1,203.0.113.5"), 1)).toBe("203.0.113.5");
});

test("without proxies, or a header shorter than them, everyone shares one key", () => {
  expect(clientIp(forwarded("203.0.113.5"), 0)).toBe("local");
  expect(clientIp(new Headers(), 1)).toBe("unknown");
  expect(clientIp(forwarded("203.0.113.5"), 2)).toBe("unknown");
});

// One home or phone gets a /64 and picks new addresses in it at will: the network is
// the /64. An IPv4 address written as IPv6 is the IPv4 address.
test("an IPv6 visitor is keyed by their /64", () => {
  expect(clientIp(forwarded("2001:db8:aa:bb:1:2:3:4"), 1)).toBe(
    "2001:db8:aa:bb::/64",
  );
  expect(clientIp(forwarded("2001:DB8:AA:BB::99"), 1)).toBe(
    "2001:db8:aa:bb::/64",
  );
  expect(clientIp(forwarded("2001:db8::1"), 1)).toBe("2001:db8:0:0::/64");
  expect(clientIp(forwarded("::ffff:203.0.113.5"), 1)).toBe("203.0.113.5");
});
