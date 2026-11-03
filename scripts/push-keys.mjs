// P3-W17-S05b (Q-P3-18): a VAPID key pair for web push, printed for the owner to store
// (VAPID_PUBLIC_KEY for the web app, VAPID_PRIVATE_KEY for the worker). node:crypto
// only; nothing is written or sent anywhere.
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const b64 = (s) => Buffer.from(s, "base64url");
const point = Buffer.concat([Buffer.from([4]), b64(jwk.x), b64(jwk.y)]);
console.log(`VAPID_PUBLIC_KEY=${point.toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
