import { createHash, randomBytes } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import {
  AGENT_PLACE_MS,
  AGENT_TASK_MS,
  type AgentDevice,
  type AgentHook,
  type BetaGroup,
  MAX_AGENT_DEVICES,
} from "../ports";

// A device token: shown once, kept only as its SHA-256.
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const device = (row: {
  id: string;
  name: string;
  created_at: Date;
  last_used_at: Date | null;
}): AgentDevice => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

const lockDevice = (trx: Kysely<DB>, deviceId: string) =>
  sql`select 1 from agent_device where id = ${deviceId} for update`.execute(
    trx,
  );

// P3-W17-S04 (§7, Q-P3-28): devices, their started and finished tasks, and the place.
export function kyselyAgentHook(db: Kysely<DB>): AgentHook {
  const inTransaction = <T>(body: (trx: Kysely<DB>) => Promise<T>) =>
    db.isTransaction ? body(db) : db.transaction().execute(body);
  return {
    devices: async (userId) =>
      (
        await db
          .selectFrom("agent_device")
          .select(["id", "name", "created_at", "last_used_at"])
          .where("user_id", "=", userId)
          .where("revoked_at", "is", null)
          .orderBy("created_at", "desc")
          .execute()
      ).map(device),

    addDevice: (userId, name) =>
      inTransaction(async (trx) => {
        // Counted under the account's row lock, so two adds can't pass 10 together.
        await sql`select 1 from app_user where id = ${userId} for update`.execute(
          trx,
        );
        const { count } = await trx
          .selectFrom("agent_device")
          // Postgres counts are bigints, returned as text.
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .where("user_id", "=", userId)
          .where("revoked_at", "is", null)
          .executeTakeFirstOrThrow();
        if (Number(count) >= MAX_AGENT_DEVICES) return "full";
        const token = `ivd_${randomBytes(32).toString("base64url")}`;
        const row = await trx
          .insertInto("agent_device")
          .values({ user_id: userId, name, token_hash: hash(token) })
          .returning(["id", "name", "created_at", "last_used_at"])
          .executeTakeFirstOrThrow();
        return { device: device(row), token };
      }),

    revoke: async (userId, deviceId) => {
      await db
        .updateTable("agent_device")
        .set({ revoked_at: sql<Date>`now()` })
        .where("id", "=", deviceId)
        .where("user_id", "=", userId)
        .where("revoked_at", "is", null)
        .execute();
    },

    deviceFor: async (token, now) => {
      const { rows } = await sql<{
        id: string;
        user_id: string;
        beta_group: BetaGroup;
      }>`
        update agent_device d set last_used_at = ${now}
        from app_user u
        where u.id = d.user_id and d.token_hash = ${hash(token)}
          and d.revoked_at is null
        returning d.id, d.user_id, u.beta_group`.execute(db);
      const row = rows[0];
      // Devices are made on Profile, which only accounts have (ADR-0029).
      return row === undefined
        ? null
        : {
            deviceId: row.id,
            actor: {
              userId: row.user_id,
              isGuest: false,
              betaGroup: row.beta_group,
            },
          };
    },

    start: (deviceId, key, now) =>
      inTransaction(async (trx) => {
        // One device's calls in turn: a retried or concurrent call sees the first's
        // effect, and a device never has two running tasks.
        await lockDevice(trx, deviceId);
        const seen = await trx
          .selectFrom("agent_task")
          .select("id")
          .where("device_id", "=", deviceId)
          .where("start_key", "=", key)
          .executeTakeFirst();
        if (seen !== undefined) return "repeat";
        // A new start replaces the device's running task (owner, 2026-11-03); one past
        // its 2 hours ended then, not now.
        await sql`update agent_task
          set finished_at = least(
            ${now}, started_at + make_interval(secs => ${AGENT_TASK_MS / 1000}))
          where device_id = ${deviceId} and finished_at is null`.execute(trx);
        await sql`
          insert into agent_task (device_id, user_id, started_at, start_key)
          select id, user_id, ${now}, ${key} from agent_device where id = ${deviceId}`.execute(
          trx,
        );
        return "started";
      }),

    finish: (deviceId, key, now, place) =>
      inTransaction(async (trx) => {
        await lockDevice(trx, deviceId);
        const seen = await trx
          .selectFrom("agent_task")
          .select("id")
          .where("device_id", "=", deviceId)
          .where("finish_key", "=", key)
          .executeTakeFirst();
        if (seen !== undefined) return { status: "repeat" };
        const running = await trx
          .selectFrom("agent_task")
          .select(["id", "started_at", "user_id"])
          .where("device_id", "=", deviceId)
          .where("finished_at", "is", null)
          .where("started_at", ">", new Date(now.getTime() - AGENT_TASK_MS))
          .orderBy("started_at", "desc")
          .executeTakeFirst();
        if (running === undefined) return { status: "none" };
        await trx
          .updateTable("agent_task")
          .set({ finished_at: now, finish_key: key })
          .where("id", "=", running.id)
          .execute();
        // The place, with the finish: both or neither, so a retry can't lose it.
        if (place !== null)
          await sql`insert into agent_place (user_id, path, saved_at)
            values (${running.user_id}, ${place}, ${now})
            on conflict (user_id) do update
              set path = excluded.path, saved_at = excluded.saved_at, opened_at = null`.execute(
            trx,
          );
        return {
          status: "finished",
          elapsedMs: Math.max(0, now.getTime() - running.started_at.getTime()),
        };
      }),

    running: async (userId, now) => {
      // A revoked device's task stops showing with it.
      const row = await db
        .selectFrom("agent_task as t")
        .innerJoin("agent_device as d", "d.id", "t.device_id")
        .select("t.started_at")
        .where("t.user_id", "=", userId)
        .where("t.finished_at", "is", null)
        .where("d.revoked_at", "is", null)
        .where("t.started_at", ">", new Date(now.getTime() - AGENT_TASK_MS))
        .orderBy("t.started_at", "desc")
        .executeTakeFirst();
      return row === undefined ? null : { startedAt: row.started_at };
    },

    place: async (userId, now) => {
      const row = await db
        .selectFrom("agent_place")
        .select("path")
        .where("user_id", "=", userId)
        .where("opened_at", "is", null)
        .where("saved_at", ">", new Date(now.getTime() - AGENT_PLACE_MS))
        .executeTakeFirst();
      return row?.path ?? null;
    },

    openedPlace: async (userId, path, now) => {
      await db
        .updateTable("agent_place")
        .set({ opened_at: now })
        .where("user_id", "=", userId)
        .where("path", "=", path)
        .where("opened_at", "is", null)
        .execute();
    },
  };
}
