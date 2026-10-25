import net from "node:net";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { checkHealth } from "../health";
import { createDb, kyselyPing } from "./kysely";

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error(
    "DATABASE_URL is not set; copy .env.example to .env and run `docker compose up -d`",
  );
}

// Accepts TCP connections and never answers: a database that is reachable but stalled.
const sockets = new Set<net.Socket>();
const stalled = net.createServer((socket) => {
  sockets.add(socket);
});
let stalledPort = 0;

beforeAll(async () => {
  await new Promise<void>((resolve) => stalled.listen(0, "127.0.0.1", resolve));
  const address = stalled.address();
  if (address === null || typeof address === "string")
    throw new Error("no port");
  stalledPort = address.port;
});

const up = createDb(connectionString);
const refused = createDb("postgres://interval:interval@127.0.0.1:1/interval");

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([up.destroy(), refused.destroy()]);
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => stalled.close(resolve));
});

function captureLines(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    },
  );
  return lines;
}

test("reports ok with 200 when the database answers", async () => {
  expect(await checkHealth(kyselyPing(up))).toEqual({
    status: "ok",
    httpStatus: 200,
  });
});

test("reports unavailable with 503 and logs one error when the connection is refused", async () => {
  const lines = captureLines();

  expect(await checkHealth(kyselyPing(refused))).toEqual({
    status: "unavailable",
    httpStatus: 503,
  });
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "")).toMatchObject({
    level: "error",
    msg: "health check: database unreachable",
    error: { code: "ECONNREFUSED" },
  });
});

test("answers 503 within the timeout when the database accepts but never replies", async () => {
  const lines = captureLines();
  const db = createDb(
    `postgres://interval:interval@127.0.0.1:${String(stalledPort)}/interval`,
  );
  const started = Date.now();

  expect(await checkHealth(kyselyPing(db))).toEqual({
    status: "unavailable",
    httpStatus: 503,
  });
  expect(Date.now() - started).toBeLessThan(2500);
  expect(lines).toHaveLength(1);
  await db.destroy();
});
