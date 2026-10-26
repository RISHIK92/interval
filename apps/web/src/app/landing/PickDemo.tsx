"use client";

import Link from "next/link";
import { useState } from "react";

// The "Same minutes, different pick" demo: canned picks, nothing is fetched.
const ROLES = {
  backend: {
    l: "Backend",
    f: "db",
    src: "Databases · Postgres Weekly",
    title: "Why your connection pool runs dry under load",
    why: "You run FastAPI on Postgres with a pool of 5. This is the limit you’ll hit first.",
  },
  frontend: {
    l: "Frontend",
    f: "ds",
    src: "Distributed systems · Edge caching",
    title: "What your CDN is really caching for each route",
    why: "Your storefront ships 40 routes from one edge config. Two of them never cache.",
  },
  ml: {
    l: "ML",
    f: "rv",
    src: "AI infra · Model serving",
    title: "Batching requests without wrecking p99 latency",
    why: "You serve an embedding model behind a queue. Batch size is your hidden knob.",
  },
  student: {
    l: "Student",
    f: "sd",
    src: "System design · Solo drill",
    title: "Design a URL shortener, then defend it",
    why: "Your goal is interviews in spring. The rubric scores trade-offs, not boxes.",
  },
};
type Role = keyof typeof ROLES;
const PLANS = {
  3: "2 min reading, then 1 recall question",
  8: "6 min reading, then a 60-second checkpoint",
  15: "12 min drill, then 3 min with the rubric",
};
type Minutes = keyof typeof PLANS;

const SEG_ON = {
  background: "var(--seg)",
  color: "var(--ink)",
  fontWeight: 600,
  boxShadow: "var(--segsh)",
};
const SEG_OFF = {
  background: "transparent",
  color: "var(--ink2)",
  fontWeight: 500,
};

export function PickDemo() {
  const [role, setRole] = useState<Role>("backend");
  const [minutes, setMinutes] = useState<Minutes>(8);
  const { f, ...picked } = ROLES[role];
  const pick = {
    ...picked,
    T: `var(--${f}T)`,
    L: `var(--${f}L)`,
    M: `var(--${f}M)`,
    S: `var(--${f}S)`,
    D: `var(--${f}D)`,
  };
  const plan = PLANS[minutes];
  const roles = (Object.keys(ROLES) as Role[]).map((k) => ({
    l: ROLES[k].l,
    on: k === role,
    st: k === role ? SEG_ON : SEG_OFF,
    pick: () => {
      setRole(k);
    },
  }));
  const mins = ([3, 8, 15] as const).map((v) => ({
    v,
    on: v === minutes,
    st: v === minutes ? SEG_ON : SEG_OFF,
    pick: () => {
      setMinutes(v);
    },
  }));
  return (
    <>
      <div className="rv2 flex flex-wrap gap-[12px] items-center">
        <div
          className="h-[52px] p-[4px] box-border rounded-[16px] bg-(--sf) flex gap-[4px] flex-wrap"
          aria-label="What you build"
        >
          {roles.map((r, i) => (
            <button
              key={i}
              className="border-0 rounded-[12px] p-[0_16px] text-[16px]"
              type="button"
              aria-pressed={r.on}
              onClick={r.pick}
              style={{ ...r.st }}
            >
              {r.l}
            </button>
          ))}
        </div>
        <div
          className="h-[52px] p-[4px] box-border rounded-[16px] bg-(--sf) flex gap-[4px]"
          aria-label="Minutes available"
        >
          {mins.map((m, i) => (
            <button
              key={i}
              className="n border-0 rounded-[12px] p-[0_16px] text-[16px]"
              type="button"
              aria-pressed={m.on}
              onClick={m.pick}
              style={{ ...m.st }}
            >
              {m.v} min
            </button>
          ))}
        </div>
      </div>
      <article className="rv3 rounded-[28px] overflow-hidden bg-(--card) [border:1px_solid_var(--ln)] [box-shadow:var(--shadow)] flex flex-wrap">
        <div
          className="flex-[1_1_320px] min-h-[260px] flex items-center justify-center"
          style={{ background: pick.T }}
        >
          <svg
            width="260"
            height="200"
            viewBox="0 0 260 200"
            aria-hidden="true"
          >
            <path d="M90 40 140 65 90 90 40 65z" style={{ fill: pick.L }} />
            <path d="M40 65 90 90v60L40 125z" style={{ fill: pick.M }} />
            <path d="M90 90 140 65v60L90 150z" style={{ fill: pick.S }} />
            <path
              d="M180 86 214 103 180 120 146 103z"
              style={{ fill: pick.L }}
            />
            <path d="M146 103 180 120v40L146 143z" style={{ fill: pick.M }} />
            <path d="M180 120 214 103v40L180 160z" style={{ fill: pick.S }} />
            <path
              className="[stroke-width:3] [stroke-linecap:round]"
              d="M140 100 150 104"
              style={{ stroke: pick.D }}
            />
            <path
              className="[fill:none] [stroke-width:3] [stroke-linecap:round] [stroke-dasharray:2_8]"
              d="M120 150 150 160"
              style={{ stroke: pick.D }}
            />
            <circle
              className="[fill:var(--card)] [stroke-width:3]"
              cx="214"
              cy="52"
              r="16"
              style={{ stroke: pick.D }}
            />
            <path
              className="[fill:none] [stroke-width:3] [stroke-linecap:round]"
              d="M214 44v8l5 4"
              style={{ stroke: pick.D }}
            />
          </svg>
        </div>
        <div className="flex-[1.4_1_360px] min-w-0 p-[28px] box-border flex flex-col gap-[12px] justify-center">
          <span className="text-[14px] font-medium text-(--ink3)">
            {pick.src}
          </span>
          <span className="text-[length:clamp(24px,2.6vw,32px)] leading-[1.12] font-bold tracking-[-0.025em]">
            {pick.title}
          </span>
          <span className="text-[17px] leading-[1.5] text-(--ink2)">
            {pick.why}
          </span>
          <span className="flex items-center gap-[8px] text-[15px] font-semibold">
            <svg
              className="i"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2.5 2M10 2h4" />
            </svg>
            {plan}
          </span>
          <Link
            className="mt-[6px] self-start h-[52px] p-[0_24px] rounded-[999px] bg-(--act) text-(--onact) flex items-center gap-[8px] text-[16px] font-semibold no-underline"
            href="/join"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
              <path className="[fill:currentColor]" d="M7 4.5v15l12-7.5z" />
            </svg>
            Start this one
          </Link>
        </div>
      </article>
    </>
  );
}
