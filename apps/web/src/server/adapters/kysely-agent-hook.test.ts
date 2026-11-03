import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAgentHook } from "./kysely-agent-hook";

// P3-W17-S04 (§7, LOAD-5, Q-P3-28): devices by hashed token, started and finished
// tasks done once per key, the 2-hour stale rule, and the saved place.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(
  body: (trx: Transaction<DB>, user: string) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `AGENT${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 10,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const user = `agent-${randomUUID()}`;
      await trx
        .insertInto("app_user")
        .values({
          id: user,
          name: "Ada",
          email: `${user}@agent.example.test`,
          beta_group: "developer",
          invite_code_id: code.id,
        })
        .execute();
      await body(trx, user);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

const at = (minutes: number) => new Date(Date.UTC(2031, 0, 1, 12, minutes));

test("a device's token is shown once, kept hashed, found by itself, and revoked", async () => {
  await inRollback(async (trx, user) => {
    const hook = kyselyAgentHook(trx);
    const added = await hook.addDevice(user, "Work laptop");
    if (added === "full") throw new Error("full");
    expect(added.token).toMatch(/^ivd_[A-Za-z0-9_-]{43}$/);
    const stored = await trx
      .selectFrom("agent_device")
      .select("token_hash")
      .where("id", "=", added.device.id)
      .executeTakeFirstOrThrow();
    expect(stored.token_hash).not.toContain(added.token.slice(4));
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hook.deviceFor(added.token, at(0))).toEqual({
      deviceId: added.device.id,
      actor: { userId: user, isGuest: false, betaGroup: "developer" },
    });
    expect(await hook.deviceFor(`${added.token}x`, at(0))).toBeNull();
    expect((await hook.devices(user))[0]?.lastUsedAt).toEqual(at(0));
    await hook.revoke(user, added.device.id);
    expect(await hook.deviceFor(added.token, at(1))).toBeNull();
    expect(await hook.devices(user)).toEqual([]);
  });
});

test("ten devices at most", async () => {
  await inRollback(async (trx, user) => {
    const hook = kyselyAgentHook(trx);
    for (let i = 0; i < 10; i += 1)
      expect(await hook.addDevice(user, `D${String(i)}`)).not.toBe("full");
    expect(await hook.addDevice(user, "Eleventh")).toBe("full");
  });
});

test("started and finished do nothing twice per key; elapsed time comes back", async () => {
  await inRollback(async (trx, user) => {
    const hook = kyselyAgentHook(trx);
    const added = await hook.addDevice(user, "Laptop");
    if (added === "full") throw new Error("full");
    const id = added.device.id;
    const started = await hook.start(id, "start-key-1", at(0));
    expect(started.status).toBe("started");
    expect(started.status === "started" && started.taskId > 0).toBe(true);
    expect(await hook.start(id, "start-key-1", at(1))).toEqual({
      status: "repeat",
    });
    expect(await hook.running(user, at(3))).toEqual({ startedAt: at(0) });
    expect(await hook.finish(id, "finish-key-1", at(4), null)).toEqual({
      status: "finished",
      elapsedMs: 240_000,
    });
    expect(await hook.finish(id, "finish-key-1", at(5), null)).toEqual({
      status: "repeat",
    });
    expect(await hook.finish(id, "finish-key-2", at(6), null)).toEqual({
      status: "none",
    });
    expect(await hook.running(user, at(6))).toBeNull();
  });
});

test("a new start replaces the running task; one 2 hours old has ended", async () => {
  await inRollback(async (trx, user) => {
    const hook = kyselyAgentHook(trx);
    const added = await hook.addDevice(user, "Laptop");
    if (added === "full") throw new Error("full");
    const id = added.device.id;
    await hook.start(id, "start-key-a", at(0));
    await hook.start(id, "start-key-b", at(10));
    expect(await hook.running(user, at(11))).toEqual({ startedAt: at(10) });
    const late = new Date(at(10).getTime() + 2 * 3_600_000);
    expect(await hook.running(user, late)).toBeNull();
    expect(await hook.finish(id, "finish-key-a", late, null)).toEqual({
      status: "none",
    });
  });
});

test("a finish saves its place with it; kept 24 hours or until opened", async () => {
  await inRollback(async (trx, user) => {
    const hook = kyselyAgentHook(trx);
    const added = await hook.addDevice(user, "Laptop");
    if (added === "full") throw new Error("full");
    const id = added.device.id;
    await hook.start(id, "start-key-p", at(0));
    await hook.finish(id, "finish-key-p", at(1), "/read/42");
    expect(await hook.place(user, at(30))).toBe("/read/42");
    const dayOn = new Date(at(1).getTime() + 24 * 3_600_000);
    expect(await hook.place(user, dayOn)).toBeNull();
    await hook.openedPlace(user, "/read/7", at(31)); // another page: not it
    expect(await hook.place(user, at(32))).toBe("/read/42");
    await hook.openedPlace(user, "/read/42", at(33));
    expect(await hook.place(user, at(34))).toBeNull();
    // A finish with no page open keeps no place; the next one saves again.
    await hook.start(id, "start-key-q", at(40));
    await hook.finish(id, "finish-key-q", at(41), null);
    expect(await hook.place(user, at(42))).toBeNull();
    await hook.start(id, "start-key-r", at(50));
    await hook.finish(id, "finish-key-r", at(51), "/paths/1");
    expect(await hook.place(user, at(52))).toBe("/paths/1");
  });
});

test("a revoked device's task stops showing; a stale task ends at its 2 hours", async () => {
  await inRollback(async (trx, user) => {
    const hook = kyselyAgentHook(trx);
    const added = await hook.addDevice(user, "Laptop");
    if (added === "full") throw new Error("full");
    const id = added.device.id;
    await hook.start(id, "start-key-s", at(0));
    const late = new Date(at(0).getTime() + 5 * 3_600_000);
    await hook.start(id, "start-key-t", late);
    const ended = await trx
      .selectFrom("agent_task")
      .select("finished_at")
      .where("start_key", "=", "start-key-s")
      .executeTakeFirstOrThrow();
    expect(ended.finished_at).toEqual(
      new Date(at(0).getTime() + 2 * 3_600_000),
    );
    expect(await hook.running(user, late)).toEqual({ startedAt: late });
    await hook.revoke(user, id);
    expect(await hook.running(user, late)).toBeNull();
  });
});

// LOAD-5 under a retry that races the first call: one task, one finish.
test("the same key sent twice at once starts once and finishes once", async () => {
  const user = `agent-${randomUUID()}`;
  const code = await db
    .insertInto("invite_code")
    .values({
      code: `AGENTC${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 10,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("app_user")
    .values({
      id: user,
      name: "Ada",
      email: `${user}@agent.example.test`,
      beta_group: "developer",
      invite_code_id: code.id,
    })
    .execute();
  try {
    const hook = kyselyAgentHook(db);
    const added = await hook.addDevice(user, "Laptop");
    if (added === "full") throw new Error("full");
    const id = added.device.id;
    const starts = await Promise.all([
      hook.start(id, "start-key-x", at(0)),
      hook.start(id, "start-key-x", at(0)),
    ]);
    expect(starts.map((s) => s.status).sort()).toEqual(["repeat", "started"]);
    expect(await hook.running(user, at(1))).toEqual({ startedAt: at(0) });
    const finishes = await Promise.all([
      hook.finish(id, "finish-key-x", at(2), "/read/9"),
      hook.finish(id, "finish-key-x", at(2), "/read/9"),
    ]);
    expect(finishes.map((f) => f.status).sort()).toEqual([
      "finished",
      "repeat",
    ]);
  } finally {
    await db.deleteFrom("app_user").where("id", "=", user).execute();
    await db.deleteFrom("invite_code").where("id", "=", code.id).execute();
  }
});
