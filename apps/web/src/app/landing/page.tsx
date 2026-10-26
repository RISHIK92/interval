import Link from "next/link";
import type { CSSProperties } from "react";
import { Fragment } from "react";
import "./landing.css";
import { ListenPlayer } from "./ListenPlayer";
import { PickDemo } from "./PickDemo";

// The public landing page (owner's design, "Landing"). No session, no data: a visitor
// signs up through /join like anywhere else.
export const metadata = { title: "Interval · For the minutes in between" };

type Style = CSSProperties & Record<`--${string}`, string>;
type Box = { label: string; st: Style };

// One CSS box in a 3D scene, centred on x, standing on `by`, in a colour family.
function box(
  x: number,
  z: number,
  w: number,
  h: number,
  d: number,
  fam: string,
  by = 0,
  opts: { rot?: number; anim?: string; label?: string } = {},
): Box {
  const rot = opts.rot === undefined ? "" : ` rotateY(${String(opts.rot)}deg)`;
  return {
    label: opts.label ?? "",
    st: {
      "--w": `${String(w)}px`,
      "--h": `${String(h)}px`,
      "--d": `${String(d)}px`,
      "--cL": `var(--${fam}L)`,
      "--cM": `var(--${fam}M)`,
      "--cS": `var(--${fam}S)`,
      transform: `translate3d(${String(x - w / 2)}px,${String(-(by + h))}px,${String(z)}px)${rot}`,
      ...(opts.anim === undefined ? {} : { animation: `lp-${opts.anim}` }),
    },
  };
}

const HEIGHTS = [
  [2, 3, 1, 4, 2],
  [1, 5, 2, 3, 1],
  [3, 2, 6, 2, 4],
  [2, 4, 3, 5, 2],
  [1, 2, 4, 3, 3],
];
const MAP_PATH = [
  [4, 0],
  [3, 0],
  [3, 1],
  [2, 1],
  [2, 2],
  [1, 2],
  [1, 3],
  [0, 3],
  [0, 4],
];
const mapBoxes = HEIGHTS.flatMap((row, r) =>
  row.map((height, c) => {
    const fam = r < 2 && c < 3 ? "db" : r < 2 ? "ds" : c < 2 ? "rv" : "sd";
    const step = MAP_PATH.findIndex(([pr, pc]) => pr === r && pc === c);
    return box(
      (c - 2) * 70,
      (r - 2) * 70,
      60,
      12 + height * 14,
      60,
      fam,
      0,
      step < 0
        ? {}
        : {
            anim: `lift 6s cubic-bezier(.2,.8,.2,1) ${String(step * 0.45)}s infinite`,
          },
    );
  }),
).concat(
  box(-140, 140, 22, 22, 22, "k", 70, {
    anim: "flt3 3s ease-in-out infinite",
  }),
);

const BOOKS = [
  { t: "Database Internals", w: 36, h: 196, f: "db" },
  { t: "Site Reliability Engineering", w: 44, h: 226, f: "ch" },
  {
    t: "Designing Data-Intensive Applications",
    w: 46,
    h: 236,
    f: "ds",
    pull: true,
  },
  { t: "Understanding Distributed Systems", w: 34, h: 206, f: "rv" },
  { t: "Release It!", w: 30, h: 182, f: "sun" },
  { t: "The Art of PostgreSQL", w: 38, h: 214, f: "mint" },
  { t: "System Design Interview", w: 40, h: 200, f: "sd" },
];
const shelf = BOOKS.reduce((a, b) => a + b.w + 6, -6);
const books = [{ ...box(0, 0, shelf + 60, 14, 180, "k", -14), t: "" }];
let left = -shelf / 2;
for (const b of BOOKS) {
  books.push({
    ...box(left + b.w / 2, 0, b.w, b.h, 150, b.f, 0, {
      ...("pull" in b && {
        anim: "pull 7s cubic-bezier(.65,0,.35,1) infinite",
      }),
    }),
    t: b.t,
  });
  left += b.w + 6;
}

const segs = Array.from({ length: 14 }, (_, i) => ({
  st:
    i < 6
      ? {
          animation: `lp-seg 8s cubic-bezier(.2,.8,.2,1) ${String(i * 0.18)}s infinite both`,
        }
      : { transform: "scaleX(0)" },
}));

const readLines = [92, 100, 84, 96, 70, 100, 88, 60, 94].map((w, i) => ({
  st: {
    width: `${String(w)}%`,
    animation: `lp-show 0.85s linear ${String(1.75 + i * 0.05)}s both`,
  },
}));
const miniWave = [14, 26, 38, 20, 32, 42, 18, 30, 40, 22, 34, 14, 28, 36].map(
  (h, i) => ({
    st: { height: `${String(h)}px`, animationDelay: `${String(-i * 0.08)}s` },
  }),
);
const phrases = [
  "Your agent is running.",
  "Eight free minutes.",
  "You read.",
  "You listen.",
  "You take on a rival.",
  "You climb.",
];

const podiumS = [
  box(0, 0, 64, 76, 64, "sun", 0, { label: "1" }),
  box(-70, 0, 64, 52, 64, "coral", 0, { label: "2" }),
  box(70, 0, 64, 36, 64, "mint", 0, { label: "3" }),
];
const games = [
  {
    t: "Fastest finger",
    d: "1v1 · first to 4 of 7",
    bg: "#FF6A55",
    icon: "M13 2 4 14h7l-1 8 9-12h-7z",
    delay: { animationDelay: "0s" },
    rv: "rv",
  },
  {
    t: "Estimation",
    d: "Back of the envelope",
    bg: "#2EC4A6",
    icon: "M4 20h4V12H4zM10 20h4V7h-4zM16 20h4V3h-4z",
    delay: { animationDelay: "-1s" },
    rv: "rv2",
  },
  {
    t: "60s sprint",
    d: "Solo or 1v1",
    bg: "#5AA9FF",
    icon: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M10 2h4",
    delay: { animationDelay: "-2s" },
    rv: "rv2",
  },
  {
    t: "Daily challenge",
    d: "Same 5 for everyone",
    bg: "#B79CFF",
    icon: "M4 5h16v16H4zM16 3v4M8 3v4M4 11h16M9 16l2 2 4-4",
    delay: { animationDelay: "-3s" },
    rv: "rv3",
  },
];

const hldBoxes = [
  box(-260, 0, 48, 58, 48, "sun", 0, { label: "Client" }),
  box(-150, 0, 64, 30, 64, "ds", 0, { label: "LB" }),
  box(-40, -70, 56, 74, 56, "ds", 0, { label: "API" }),
  box(-40, 70, 56, 74, 56, "ds", 0, { label: "API" }),
  box(90, -110, 64, 40, 64, "ch", 0, { label: "Cache" }),
  box(100, 20, 72, 96, 72, "db", 0, { label: "Primary" }),
  box(220, 20, 60, 72, 60, "db", 0, { label: "Replica" }),
  box(80, 150, 120, 22, 44, "sd", 0, { label: "Queue" }),
  box(220, 150, 54, 54, 54, "sd", 0, { label: "Worker" }),
];
const packets = [
  ["sun", "pa 3s linear infinite"],
  ["sun", "pa 3s linear -1s infinite"],
  ["sun", "pa 3s linear -2s infinite"],
  ["mint", "pb 3.4s linear -0.6s infinite"],
  ["mint", "pb 3.4s linear -2.3s infinite"],
  ["db", "pc 1.4s linear infinite"],
  ["db", "pc 1.4s linear -0.7s infinite"],
  ["sd", "pd 4s linear infinite"],
  ["sd", "pd 4s linear -2s infinite"],
].map(([fam = "", anim = ""]) => box(0, 0, 14, 14, 14, fam, 0, { anim }));
const reqs = [
  "Handles 10k reads a second",
  "p99 under 200 ms",
  "Survives losing a replica",
  "No write is ever lost",
].map((t, i) => ({ t, st: { animationDelay: `${String(0.6 + i * 1.1)}s` } }));

const CODE_COLORS = { k: "#C4ADFF", d: "#9DB4FF", r: "#FFC896", x: "#E6E8EC" };
const code = (
  [
    ["from collections import OrderedDict", "k"],
    ["", "x"],
    ["class LRUCache:", "d"],
    ["    def __init__(self, capacity):", "d"],
    ["        self.cap = capacity", "x"],
    ["        self.items = OrderedDict()", "x"],
    ["    def get(self, key):", "d"],
    ["        if key not in self.items: return -1", "r"],
    ["        self.items.move_to_end(key)", "x"],
    ["        return self.items[key]", "r"],
    ["    def put(self, key, value):", "d"],
    ["        self.items[key] = value", "x"],
    ["        if len(self.items) > self.cap:", "r"],
    ["            self.items.popitem(last=False)", "x"],
  ] as const
).map(([t, kind], i) => ({
  n: String(i + 1),
  t: t || " ",
  st: {
    color: CODE_COLORS[kind],
    animation: `lp-type 14s steps(30) ${String(i * 0.42)}s infinite both`,
  },
}));
const tests = [
  "test_get_missing_returns_minus_one",
  "test_put_then_get",
  "test_evicts_least_recent",
  "test_get_refreshes_recency",
  "test_capacity_per_user",
].map((t, i) => ({ t, st: { animationDelay: `${String(0.8 + i * 0.9)}s` } }));

const ROW = { row: true, line: false, you: false };
const ladder = [
  { ...ROW, p: "4", n: "Marco T.", s: "412", st: { color: "#101217" } },
  {
    ...ROW,
    you: true,
    p: "5",
    n: "You",
    s: "397",
    st: { background: "#101217", color: "#FFFFFF", fontWeight: 600 },
  },
  { ...ROW, p: "6", n: "Omar F.", s: "394", st: { color: "#101217" } },
  { ...ROW, p: "7", n: "Jun L.", s: "390", st: { color: "#101217" } },
  { row: false, line: true, you: false, p: "", n: "", s: "", st: {} },
  { ...ROW, p: "8", n: "Priya N.", s: "371", st: { color: "#454A55" } },
];

const minds = [
  {
    t: "Wants the rematch.",
    d: "Leagues of 30 at your pace, promotion you can see coming.",
    T: "var(--chT)",
    anim: "sway",
    rv: "rv",
    boxes: [
      box(0, 0, 56, 74, 56, "sun"),
      box(-62, 0, 56, 50, 56, "coral"),
      box(62, 0, 56, 34, 56, "mint"),
    ],
  },
  {
    t: "Opens one more tab.",
    d: "Ask anything, follow the thread, end up somewhere useful.",
    T: "var(--dsT)",
    anim: "spinS",
    rv: "rv2",
    boxes: [
      box(-50, -20, 30, 30, 30, "ds", 20, {
        anim: "flt3 3.6s ease-in-out infinite",
      }),
      box(30, 30, 24, 24, 24, "db", 60, {
        anim: "flt3 4s ease-in-out -1s infinite",
      }),
      box(50, -40, 34, 34, 34, "ds"),
      box(-20, 40, 20, 20, 20, "sd", 90, {
        anim: "flt3 3.2s ease-in-out -2s infinite",
      }),
    ],
  },
  {
    t: "Asks why. Then asks again.",
    d: "Explanations built on your own project, not a textbook’s.",
    T: "var(--rvT)",
    anim: "spinS",
    rv: "rv3",
    boxes: [box(0, 0, 84, 84, 84, "rv", 6, { label: "?" })],
  },
  {
    t: "Finishes the chapter.",
    d: "Long books, short sessions, a finish date you can trust.",
    T: "var(--dbT)",
    anim: "sway",
    rv: "rv3",
    boxes: [
      box(0, 0, 110, 18, 76, "db"),
      box(4, 0, 104, 18, 72, "ds", 18, { rot: 8 }),
      box(-4, 0, 100, 16, 70, "sd", 36, { rot: -6 }),
      box(0, 0, 96, 16, 68, "rv", 52, { rot: 4 }),
    ],
  },
];

const TOPICS = [
  ["Replication lag", "var(--dsM)"],
  ["Connection pools", "var(--dbM)"],
  ["Consistent hashing", "var(--sdM)"],
  ["Rate limiting", "var(--chM)"],
  ["Back-pressure", "var(--rvM)"],
  ["B-tree indexes", "var(--dbM)"],
  ["Raft", "var(--dsM)"],
  ["Write-ahead logs", "var(--sunM)"],
  ["Idempotency keys", "var(--sdM)"],
  ["Queues and retries", "var(--mintM)"],
] as const;
// Twice over, so the marquee loops seamlessly at -50%.
const marquee = [...TOPICS, ...TOPICS].map(([t, c]) => ({ t, c }));

const ticks = Array.from({ length: 16 }, (_, i) => ({
  st: {
    left: `${String((i / 15) * 100)}%`,
    height: [0, 3, 8, 15].includes(i) ? "22px" : "12px",
  },
}));

const sizes = [
  { m: "3", l: "a review" },
  { m: "8", l: "a session" },
  { m: "15", l: "a drill" },
];
const questions = [
  "why does my replica lag behind the leader?",
  "when should a write go to a queue?",
  "what breaks first at 10× traffic?",
  // The first again, so the rotation ends where it starts.
  "why does my replica lag behind the leader?",
];
const steps = [
  {
    n: "1",
    t: "It notices the gap",
    d: "From your agent, your build or your calendar. No timer to set.",
    rv: "rv",
  },
  {
    n: "2",
    t: "It sizes the pick",
    d: "3, 8 or 15 minutes of reading, recall or a match. Never a feed.",
    rv: "rv2",
  },
  {
    n: "3",
    t: "It hands you back",
    d: "When the work is done you’re back in your code, with your spot saved.",
    rv: "rv3",
  },
];
const chapters = [
  { t: "Ch 5 · Replication", s: "3 sessions left", c: "var(--dsM)" },
  { t: "Ch 6 · Partitioning", s: "4 sessions", c: "var(--dbM)" },
  { t: "Ch 7 · Transactions", s: "5 sessions", c: "var(--sdM)" },
];

export default function LandingPage() {
  return (
    <div className="landing w-full bg-(--bg) text-(--ink) overflow-x-clip relative">
      <div
        className="pre fixed inset-0 z-[60] bg-(--bg) flex flex-col items-center justify-center gap-[6px] p-[24px] overflow-hidden"
        aria-hidden="true"
      >
        <div className="stg relative w-[680px] h-[380px] flex-none">
          <div className="absolute inset-0 [animation:lp-grpA_3.4s_linear_both]">
            <div className="absolute left-[30px] top-[56px] w-[340px] h-[212px] box-border rounded-[16px] bg-[#15181D] [border:9px_solid_#2A2E36] p-[16px] text-[#F3F4F6] overflow-hidden [animation:lp-popIn_0.55s_cubic-bezier(.2,.8,.2,1)_0.05s_both]">
              <div className="flex items-center gap-[6px]">
                <span className="w-[9px] h-[9px] rounded-[9px] bg-[#FF6B72]"></span>
                <span className="w-[9px] h-[9px] rounded-[9px] bg-[#F2B92E]"></span>
                <span className="w-[9px] h-[9px] rounded-[9px] bg-[#35D07F]"></span>
                <span className="mono ml-[8px] text-[12px] text-[#8F95A1]">
                  agent session
                </span>
              </div>
              <div className="mono mt-[14px] text-[13px] leading-[1.7] text-[#BCC1CB]">
                › refactor billing-api
                <br />
                › run test suite
                <br />› open pull request
              </div>
              <div className="absolute left-[16px] right-[16px] bottom-[16px] h-[7px] rounded-[4px] bg-[#2A2E36] overflow-hidden flex">
                <span className="h-full bg-[#5B82F5] [animation:lp-agent_5s_linear_0.2s_both]"></span>
              </div>
              <div className="absolute left-[16px] right-[16px] bottom-[34px] p-[10px_12px] rounded-[12px] bg-[#F3F4F6] text-[#101217] text-[14px] font-bold flex items-center gap-[8px] [animation:lp-show_1.2s_cubic-bezier(.2,.8,.2,1)_0.6s_both]">
                <span className="w-[10px] h-[10px] rounded-[9px] bg-[#35D07F]"></span>
                8 free minutes
              </div>
            </div>
            <div className="absolute left-[4px] top-[268px] w-[392px] h-[16px] rounded-[0_0_14px_14px] bg-(--ln2) [animation:lp-popIn_0.55s_cubic-bezier(.2,.8,.2,1)_0.1s_both]" />
            <div className="absolute left-[470px] top-[40px] w-[140px] h-[260px] box-border rounded-[26px] bg-(--card) [border:7px_solid_#101217] overflow-hidden text-[#101217] [animation:lp-phoneIn_0.6s_cubic-bezier(.2,.8,.2,1)_0.85s_both]">
              <div className="absolute inset-0 p-[16px_12px] flex flex-col gap-[8px] bg-[#FFFFFF] [animation:lp-show_0.85s_linear_0.95s_both]">
                <span className="text-[10px] font-semibold text-[#666C78]">
                  For your 8 minutes
                </span>
                <span className="h-[74px] rounded-[12px] bg-[#E9EEFF] flex items-center justify-center">
                  <svg
                    width="60"
                    height="40"
                    viewBox="0 0 60 40"
                    aria-hidden="true"
                  >
                    <path
                      className="[fill:#5B86FF]"
                      d="M6 8v20a12 4 0 0 0 24 0V8z"
                    />
                    <ellipse
                      className="[fill:#A9BEFF]"
                      cx="18"
                      cy="8"
                      rx="12"
                      ry="4"
                    />
                    <path
                      className="[fill:#5B86FF]"
                      d="M38 16v14a8 3 0 0 0 16 0V16z"
                    />
                    <ellipse
                      className="[fill:#A9BEFF]"
                      cx="46"
                      cy="16"
                      rx="8"
                      ry="3"
                    />
                  </svg>
                </span>
                <span className="text-[13px] font-bold leading-[1.2]">
                  Replication lag, session 2
                </span>
                <span className="mt-auto h-[26px] rounded-[99px] bg-[#101217] text-[#FFFFFF] flex items-center justify-center text-[10px] font-semibold">
                  Continue
                </span>
              </div>
              <div className="absolute inset-0 p-[16px_12px] flex flex-col gap-[7px] bg-[#FFFFFF] [animation:lp-show_0.85s_linear_1.75s_both]">
                <span className="text-[13px] font-bold">Replication lag</span>
                {readLines.map((r, i) => (
                  <span
                    key={i}
                    className="h-[6px] rounded-[3px] bg-[#CDD1D8]"
                    style={{ ...r.st }}
                  ></span>
                ))}
                <span className="mt-auto h-[4px] rounded-[2px] bg-[#E6E8EC] overflow-hidden flex">
                  <span className="h-full bg-[#12A150] [animation:lp-agent_0.8s_linear_1.75s_both]"></span>
                </span>
              </div>
              <div className="absolute inset-0 p-[16px_12px] flex flex-col items-center gap-[14px] bg-[#FFFFFF] [animation:lp-show_0.85s_linear_2.55s_both]">
                <span className="w-[84px] h-[84px] rounded-[16px] bg-[#DEF6F1] mt-[8px] flex items-center justify-center">
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 40 40"
                    aria-hidden="true"
                  >
                    <path
                      className="[fill:#1DB9A1]"
                      d="M6 10v20a14 5 0 0 0 28 0V10z"
                    />
                    <ellipse
                      className="[fill:#8FE3D3]"
                      cx="20"
                      cy="10"
                      rx="14"
                      ry="5"
                    />
                  </svg>
                </span>
                <span className="flex items-center gap-[3px] h-[44px]">
                  {miniWave.map((w, i) => (
                    <span
                      key={i}
                      className="w-[4px] rounded-[2px] bg-[#101217] [animation:lp-wave_0.9s_ease-in-out_infinite]"
                      style={{ ...w.st }}
                    ></span>
                  ))}
                </span>
                <span className="w-[34px] h-[34px] rounded-[99px] bg-[#101217]"></span>
              </div>
            </div>
            <svg
              className="absolute left-[440px] top-[-14px] overflow-visible [animation:lp-dropDown_0.8s_cubic-bezier(.2,.8,.2,1)_2.4s_both]"
              width="200"
              height="150"
              viewBox="0 0 200 150"
              aria-hidden="true"
            >
              <path
                className="[fill:none] [stroke:#101217] [stroke-width:13] [stroke-linecap:round]"
                d="M28 110V84a72 72 0 0 1 144 0v26"
              />
              <rect
                className="[fill:#F25A61] [stroke:#101217] [stroke-width:5]"
                x="10"
                y="88"
                width="34"
                height="58"
                rx="14"
              />
              <rect
                className="[fill:#F25A61] [stroke:#101217] [stroke-width:5]"
                x="156"
                y="88"
                width="34"
                height="58"
                rx="14"
              />
            </svg>
          </div>
          <div className="absolute inset-0 flex items-center justify-center gap-[28px] [animation:lp-win_0.95s_linear_3.3s_both]">
            <div className="w-[190px] p-[18px] box-border rounded-[28px] bg-(--sf) flex flex-col items-center gap-[12px] [animation:lp-slideL_0.5s_cubic-bezier(.2,.8,.2,1)_3.32s_both]">
              <span className="w-[110px] h-[110px] rounded-[28px] bg-[#35D07F] [border:5px_solid_#101217] box-border flex items-center justify-center text-[38px] font-extrabold text-[#101217]">
                AK
              </span>
              <span className="flex items-center gap-[8px]">
                <span className="w-[28px] h-[28px] rounded-[8px] bg-[#101217] text-[#FFFFFF] flex items-center justify-center text-[15px] font-extrabold">
                  A
                </span>
                <span className="text-[20px] font-bold">You</span>
              </span>
              <span className="n text-[15px] text-(--ink2)">3 rounds</span>
            </div>
            <span className="w-[76px] h-[76px] rounded-[99px] bg-[#101217] text-[#FFFFFF] flex items-center justify-center text-[26px] font-extrabold flex-none [animation:lp-vsPop_1.2s_cubic-bezier(.2,.8,.2,1)_3.25s_both]">
              VS
            </span>
            <div className="w-[190px] p-[18px] box-border rounded-[28px] bg-(--sf) flex flex-col items-center gap-[12px] [animation:lp-slideR_0.5s_cubic-bezier(.2,.8,.2,1)_3.38s_both]">
              <span className="w-[110px] h-[110px] rounded-[28px] bg-[#FF6A55] [border:5px_solid_#101217] box-border flex items-center justify-center text-[38px] font-extrabold text-[#101217]">
                RS
              </span>
              <span className="flex items-center gap-[8px]">
                <span className="w-[28px] h-[28px] rounded-[8px] bg-[#101217] text-[#FFFFFF] flex items-center justify-center text-[15px] font-extrabold">
                  B
                </span>
                <span className="text-[20px] font-bold">Riya</span>
              </span>
              <span className="n text-[15px] text-(--ink2)">2 rounds</span>
            </div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center [animation:lp-showLast_0.4s_cubic-bezier(.2,.8,.2,1)_4.15s_both]">
            <div className="w-[420px] rounded-[28px] bg-(--card) [border:1px_solid_var(--ln)] [box-shadow:var(--shadow)] p-[16px] box-border flex flex-col gap-[10px]">
              <span className="flex items-center justify-between text-[17px] font-bold p-[0_6px]">
                <span>Your league this week</span>
                <span className="n h-[26px] p-[0_10px] rounded-[99px] bg-[#35D07F] text-[#101217] flex items-center text-[13px] font-bold [animation:lp-popIn_0.4s_cubic-bezier(.2,.8,.2,1)_4.95s_both]">
                  up 3
                </span>
              </span>
              <div className="flex gap-[10px]">
                <div className="n w-[28px] flex flex-col text-[16px] font-bold text-(--ink3)">
                  <span className="h-[46px] flex items-center justify-center">
                    4
                  </span>
                  <span className="h-[46px] flex items-center justify-center">
                    5
                  </span>
                  <span className="h-[46px] flex items-center justify-center">
                    6
                  </span>
                  <span className="h-[46px] flex items-center justify-center">
                    7
                  </span>
                  <span className="h-[46px] flex items-center justify-center">
                    8
                  </span>
                </div>
                <div className="flex-1 relative h-[230px]">
                  <span className="absolute left-0 right-0 top-0 h-[40px] mt-[3px] p-[0_14px] box-border rounded-[12px] bg-(--sf) flex items-center justify-between text-[16px]">
                    <span>Marco T.</span>
                    <span className="n font-bold">412</span>
                  </span>
                  <span className="absolute left-0 right-0 top-[46px] h-[40px] mt-[3px] p-[0_14px] box-border rounded-[12px] bg-(--sf) flex items-center justify-between text-[16px] [animation:lp-down1_0.3s_cubic-bezier(.2,.8,.2,1)_4.68s_both]">
                    <span>Omar F.</span>
                    <span className="n font-bold">394</span>
                  </span>
                  <span className="absolute left-0 right-0 top-[92px] h-[40px] mt-[3px] p-[0_14px] box-border rounded-[12px] bg-(--sf) flex items-center justify-between text-[16px] [animation:lp-down1_0.3s_cubic-bezier(.2,.8,.2,1)_4.56s_both]">
                    <span>Jun L.</span>
                    <span className="n font-bold">390</span>
                  </span>
                  <span className="absolute left-0 right-0 top-[138px] h-[40px] mt-[3px] p-[0_14px] box-border rounded-[12px] bg-(--sf) flex items-center justify-between text-[16px] [animation:lp-down1_0.3s_cubic-bezier(.2,.8,.2,1)_4.44s_both]">
                    <span>Priya N.</span>
                    <span className="n font-bold">388</span>
                  </span>
                  <span className="absolute left-0 right-0 top-[184px] h-[40px] mt-[3px] p-[0_14px] box-border rounded-[12px] bg-(--act) text-(--onact) font-semibold flex items-center justify-between text-[16px] z-[2] [animation:lp-climb_0.75s_cubic-bezier(.65,0,.35,1)_4.35s_both]">
                    <span>You</span>
                    <span className="n font-bold">397</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="h-[46px] overflow-hidden">
          <div className="flex flex-col items-center [animation:lp-cap6_4.8s_cubic-bezier(.65,0,.35,1)_both]">
            {phrases.map((p, i) => (
              <span
                key={i}
                className="h-[46px] flex-none flex items-center whitespace-nowrap text-[34px] font-bold tracking-[-0.035em]"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
      <header className="in d0 max-w-[1200px] mx-auto p-[22px_32px] flex items-center gap-[20px] flex-wrap">
        <a
          className="flex items-center gap-[10px] text-(--ink) no-underline"
          href="#top"
        >
          <span
            className="w-[34px] h-[34px] rounded-[10px] bg-(--act) flex items-center justify-center gap-[4px]"
            aria-hidden="true"
          >
            <span className="w-[5px] h-[16px] rounded-[3px] bg-(--onact)"></span>
            <span className="w-[7px] h-[7px] rounded-[9px] bg-[#35D07F] self-end mb-[9px]"></span>
          </span>
          <span className="text-[22px] font-bold tracking-[-0.03em]">
            Interval
          </span>
        </a>
        <nav className="flex gap-[2px] flex-wrap ml-auto" aria-label="Sections">
          <a
            className="p-[10px_12px] rounded-[10px] text-[15px] font-medium text-(--ink2) no-underline"
            href="#how"
          >
            How it works
          </a>
          <a
            className="p-[10px_12px] rounded-[10px] text-[15px] font-medium text-(--ink2) no-underline"
            href="#explore"
          >
            Explore
          </a>
          <a
            className="p-[10px_12px] rounded-[10px] text-[15px] font-medium text-(--ink2) no-underline"
            href="#paths"
          >
            Books
          </a>
          <a
            className="p-[10px_12px] rounded-[10px] text-[15px] font-medium text-(--ink2) no-underline"
            href="#listen"
          >
            Listen
          </a>
          <a
            className="p-[10px_12px] rounded-[10px] text-[15px] font-medium text-(--ink2) no-underline"
            href="#play"
          >
            Play
          </a>
        </nav>
        <Link
          className="h-[44px] p-[0_20px] rounded-[999px] bg-(--act) text-(--onact) flex items-center text-[15px] font-semibold no-underline"
          href="/join"
        >
          Start free
        </Link>
      </header>
      <section
        className="max-w-[1200px] mx-auto p-[40px_32px_90px] flex flex-wrap items-center gap-[32px]"
        id="top"
      >
        <div className="flex-[1_1_440px] min-w-0 flex flex-col gap-[24px]">
          <span className="in d1 self-start h-[38px] p-[0_14px_0_8px] box-border rounded-[999px] bg-(--sf) flex items-center gap-[10px] text-[14px] font-medium text-(--ink2)">
            <span className="w-[24px] h-[24px] rounded-[999px] bg-(--act) flex items-center justify-center">
              <span className="pulse w-[8px] h-[8px] rounded-[9px] bg-[#35D07F]"></span>
            </span>
            <span className="mono text-[13px]">agent running · 8 min left</span>
          </span>
          <h1 className="in d2 m-0 text-[length:clamp(46px,6.2vw,86px)] leading-[0.98] font-bold tracking-[-0.045em]">
            While the agent works, you get{" "}
            <span className="[box-shadow:inset_0_-0.2em_0_var(--goT)]">
              sharper.
            </span>
          </h1>
          <p className="in d3 m-0 text-[20px] leading-[1.5] text-(--ink2) max-w-[520px]">
            Interval turns the 3, 8 and 15-minute gaps in your day into reading,
            recall and quick matches. Every pick is sized to the break and tied
            to the stack you actually ship.
          </p>
          <div className="in d4 flex gap-[10px] flex-wrap">
            <Link
              className="h-[56px] p-[0_26px] rounded-[999px] bg-(--act) text-(--onact) flex items-center gap-[10px] text-[17px] font-semibold no-underline"
              href="/join"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path className="[fill:currentColor]" d="M7 4.5v15l12-7.5z" />
              </svg>
              Start with 3 minutes
            </Link>
            <a
              className="h-[56px] p-[0_24px] box-border rounded-[999px] [border:1.5px_solid_var(--ln2)] text-(--ink) flex items-center text-[17px] font-semibold no-underline"
              href="#make"
            >
              See a pick for you
            </a>
          </div>
          <div className="in d5 flex gap-[18px] flex-wrap pt-[6px]">
            {sizes.map((z, i) => (
              <div key={i} className="flex items-baseline gap-[8px]">
                <span className="n text-[28px] font-bold tracking-[-0.03em]">
                  {z.m}
                </span>
                <span className="text-[14px] text-(--ink3)">min · {z.l}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="in d3 flex-[1_1_520px] min-w-0 flex justify-center">
          <div className="scn w-[560px] h-[540px] max-[720px]:mb-[-216px]">
            <div className="flt absolute left-0 top-[70px] z-[2] h-[44px] p-[0_14px_0_10px] rounded-[999px] bg-(--card) [box-shadow:var(--shadow)] [border:1px_solid_var(--ln)] flex items-center gap-[8px] text-[14px] font-semibold">
              <span className="w-[24px] h-[24px] rounded-[99px] bg-(--goT) text-(--goTx) flex items-center justify-center">
                <svg
                  className="i [stroke-width:2.6]"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </span>
              Recall locked in · 60s
            </div>
            <div className="flt absolute right-0 top-[20px] z-[2] [animation-delay:-2s] h-[44px] p-[0_14px_0_10px] rounded-[999px] bg-(--card) [box-shadow:var(--shadow)] [border:1px_solid_var(--ln)] flex items-center gap-[8px] text-[14px] font-semibold">
              <svg
                width="22"
                height="22"
                viewBox="0 0 28 28"
                aria-hidden="true"
              >
                <path className="[fill:var(--dsL)]" d="M7 4h14l5 7H2z" />
                <path className="[fill:var(--dsM)]" d="M2 11h24L14 25z" />
              </svg>
              <span className="n">League · 8th → 5th</span>
            </div>
            <div className="flt absolute right-[20px] bottom-[6px] z-[2] [animation-delay:-4s] p-[12px_14px] rounded-[18px] bg-(--card) [box-shadow:var(--shadow)] [border:1px_solid_var(--ln)] flex flex-col gap-[8px] w-[220px]">
              <span className="text-[12px] font-medium text-(--ink3)">
                DDIA · chapter 5
              </span>
              <span className="text-[15px] font-semibold">
                Replication lag, session 2 of 3
              </span>
              <span className="flex gap-[4px]" aria-hidden="true">
                <span className="flex-1 h-[6px] rounded-[3px] bg-(--go)"></span>
                <span className="flex-1 h-[6px] rounded-[3px] bg-(--sf2) overflow-hidden flex">
                  <span className="w-[45%] bg-(--go)"></span>
                </span>
                <span className="flex-1 h-[6px] rounded-[3px] bg-(--sf2)"></span>
              </span>
            </div>
            <div className="absolute inset-0" aria-hidden="true">
              <div className="absolute left-[50px] top-[50px] w-[460px] h-[460px] rounded-[50%] bg-(--sf)" />
              <span className="flt absolute left-[170px] top-[112px] w-[42px] h-[42px] rounded-[12px] bg-(--chM) [box-shadow:inset_0_-8px_0_var(--chS)]"></span>
              <span className="flt absolute left-[250px] top-[76px] w-[34px] h-[34px] rounded-[10px] bg-(--dsM) [box-shadow:inset_0_-7px_0_var(--dsS)] [animation-delay:-1.6s]"></span>
              <span className="flt absolute left-[322px] top-[118px] w-[38px] h-[38px] rounded-[11px] bg-(--sunM) [box-shadow:inset_0_-7px_0_var(--sunS)] [animation-delay:-3s]"></span>
              <div className="absolute left-[92px] top-[186px] w-[326px] h-[206px] box-border rounded-[16px] bg-[#15181D] [border:9px_solid_#2A2E36] p-[16px] flex flex-col gap-[12px] text-[#F3F4F6]">
                <div className="flex items-center gap-[6px]">
                  <span className="w-[9px] h-[9px] rounded-[9px] bg-[#FF6B72]"></span>
                  <span className="w-[9px] h-[9px] rounded-[9px] bg-[#F2B92E]"></span>
                  <span className="w-[9px] h-[9px] rounded-[9px] bg-[#35D07F]"></span>
                  <span className="mono ml-[8px] text-[12px] text-[#8F95A1]">
                    agent
                  </span>
                </div>
                <span className="mono text-[13px] leading-[1.65] text-[#BCC1CB]">
                  › refactor billing-api/pool.py
                  <br />
                  › running test suite
                  <br />› est. 8 min
                </span>
                <span className="mt-auto h-[7px] rounded-[4px] bg-[#2A2E36] overflow-hidden flex">
                  <span className="h-full rounded-[4px] bg-[#5B82F5] [animation:lp-agent_12s_linear_infinite]"></span>
                </span>
              </div>
              <div className="absolute left-[66px] top-[392px] w-[378px] h-[16px] rounded-[0_0_14px_14px] bg-(--ln2)" />
              <div className="absolute left-[225px] top-[392px] w-[60px] h-[6px] rounded-[0_0_6px_6px] bg-(--ink3) opacity-[0.35]" />
              <div className="absolute left-[430px] top-[340px] w-[118px] h-[22px] rounded-[5px] bg-(--mintM) flex items-center gap-[6px] p-[0_12px] box-border">
                <span className="w-[26px] h-[4px] rounded-[2px] bg-[#FFFFFF] opacity-[0.7]"></span>
                <span className="w-[10px] h-[4px] rounded-[2px] bg-[#FFFFFF] opacity-[0.7]"></span>
              </div>
              <div className="absolute left-[438px] top-[362px] w-[108px] h-[22px] rounded-[5px] bg-(--sdM) flex items-center gap-[6px] p-[0_12px] box-border">
                <span className="w-[22px] h-[4px] rounded-[2px] bg-[#FFFFFF] opacity-[0.7]"></span>
                <span className="w-[14px] h-[4px] rounded-[2px] bg-[#FFFFFF] opacity-[0.7]"></span>
              </div>
              <div className="absolute left-[426px] top-[384px] w-[128px] h-[24px] rounded-[5px] bg-(--dsM) flex items-center gap-[6px] p-[0_12px] box-border">
                <span className="w-[30px] h-[4px] rounded-[2px] bg-[#FFFFFF] opacity-[0.7]"></span>
                <span className="w-[10px] h-[4px] rounded-[2px] bg-[#FFFFFF] opacity-[0.7]"></span>
              </div>
              <div className="absolute left-[14px] top-[366px] w-[112px] h-[14px] rounded-[5px] bg-(--rvL)" />
              <div className="absolute left-[8px] top-[380px] w-[118px] h-[14px] rounded-[5px] bg-(--rvM)" />
              <div className="absolute left-[12px] top-[394px] w-[114px] h-[14px] rounded-[5px] bg-(--rvS)" />
              <div className="absolute left-0 top-[408px] w-[560px] h-[2px] rounded-[1px] bg-(--ln)" />
            </div>
          </div>
        </div>
      </section>
      <div
        className="[border-top:1px_solid_var(--ln)] [border-bottom:1px_solid_var(--ln)] overflow-hidden h-[76px] flex items-center"
        aria-hidden="true"
      >
        <div className="flex gap-[40px] w-[max-content] pl-[40px] [animation:lp-marq_48s_linear_infinite]">
          {marquee.map((q, i) => (
            <span
              key={i}
              className="flex items-center gap-[12px] text-[20px] font-semibold tracking-[-0.015em] whitespace-nowrap"
            >
              <span
                className="w-[14px] h-[14px] rounded-[4px]"
                style={{ background: q.c }}
              ></span>
              {q.t}
            </span>
          ))}
        </div>
      </div>
      <section
        className="max-w-[1200px] mx-auto p-[120px_32px] flex flex-col gap-[40px]"
        id="how"
      >
        <div className="rv flex flex-col gap-[14px] max-w-[760px]">
          <span className="text-[14px] font-semibold text-(--ink3)">
            01 · The gap
          </span>
          <h2 className="m-0 text-[length:clamp(36px,4.4vw,56px)] leading-[1.02] font-bold tracking-[-0.04em]">
            Agents take minutes. Interval gives them back to you.
          </h2>
          <p className="m-0 text-[19px] leading-[1.55] text-(--ink2)">
            Kick off a refactor, a test run or a deploy and you get a few
            minutes you didn’t plan for. Interval notices, sizes a pick to fit,
            and hands you back to your code the moment the work is done.
          </p>
        </div>
        <div className="rv2 rounded-[28px] bg-[#0E1014] text-[#F3F4F6] p-[28px] flex flex-col gap-[22px] relative">
          <div className="flex items-center gap-[10px] flex-wrap">
            <span className="flex gap-[5px]" aria-hidden="true">
              <span className="w-[9px] h-[9px] rounded-[9px] bg-[#FF6B72]"></span>
              <span className="w-[9px] h-[9px] rounded-[9px] bg-[#F2B92E]"></span>
              <span className="w-[9px] h-[9px] rounded-[9px] bg-[#35D07F]"></span>
            </span>
            <span className="mono text-[13px] text-[#BCC1CB]">
              ~/billing-api · agent session
            </span>
            <span className="mono ml-auto text-[13px] text-[#8F95A1]">
              loops every 12s
            </span>
          </div>
          <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-[18px_16px] items-center">
            <span className="text-[15px] font-semibold text-[#BCC1CB]">
              Agent
            </span>
            <div className="h-[44px] rounded-[12px] bg-[#1A1D23] overflow-hidden relative">
              <div className="absolute left-0 top-0 bottom-0 bg-[#3557C4] [animation:lp-agent_12s_linear_infinite]" />
              <span className="mono absolute left-[14px] top-0 bottom-0 flex items-center text-[13px] text-[#F3F4F6]">
                refactor pool.py · run tests · open PR
              </span>
            </div>
            <span className="text-[15px] font-semibold text-[#BCC1CB]">
              You
            </span>
            <div className="h-[64px] rounded-[12px] bg-[#1A1D23] relative">
              <div className="absolute left-[3%] top-[8px] bottom-[8px] w-[27%] rounded-[10px] bg-[#19A890] text-[#101217] flex flex-col justify-center p-[0_12px] box-border [animation:lp-b1_12s_linear_infinite]">
                <span className="text-[14px] font-bold">Read · 3 min</span>
                <span className="text-[12px] font-medium">
                  Why pools run dry
                </span>
              </div>
              <div className="absolute left-[36%] top-[8px] bottom-[8px] w-[27%] rounded-[10px] bg-[#9468F7] text-[#101217] flex flex-col justify-center p-[0_12px] box-border [animation:lp-b2_12s_linear_infinite]">
                <span className="text-[14px] font-bold">Recall · 1 min</span>
                <span className="text-[12px] font-medium">3 cards, fading</span>
              </div>
              <div className="absolute left-[68%] top-[8px] bottom-[8px] w-[24%] rounded-[10px] bg-[#F2B92E] text-[#101217] flex flex-col justify-center p-[0_12px] box-border [animation:lp-b3_12s_linear_infinite]">
                <span className="text-[14px] font-bold">Sprint · 60s</span>
                <span className="text-[12px] font-medium">vs Riya</span>
              </div>
            </div>
          </div>
          <div className="self-end h-[40px] p-[0_14px] rounded-[999px] bg-[#F3F4F6] text-[#101217] flex items-center gap-[8px] text-[14px] font-semibold [animation:lp-done_12s_linear_infinite]">
            <svg
              className="i"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
            Agent finished · back to code, your spot is saved
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[24px]">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`${s.rv} flex flex-col gap-[8px] pt-[18px] [border-top:2px_solid_var(--ink)]`}
            >
              <span className="n text-[14px] font-semibold text-(--ink3)">
                {s.n}
              </span>
              <span className="text-[22px] font-bold tracking-[-0.02em]">
                {s.t}
              </span>
              <span className="text-[17px] leading-[1.5] text-(--ink2)">
                {s.d}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="bg-(--sf)" id="explore">
        <div className="max-w-[1200px] mx-auto p-[120px_32px] flex flex-wrap items-center gap-[40px]">
          <div className="flex-[1_1_420px] min-w-0 flex flex-col gap-[22px]">
            <div className="rv flex flex-col gap-[14px]">
              <span className="text-[14px] font-semibold text-(--ink3)">
                02 · Explore
              </span>
              <h2 className="m-0 text-[length:clamp(36px,4.4vw,56px)] leading-[1.02] font-bold tracking-[-0.04em]">
                Ask the question you were too busy to ask.
              </h2>
              <p className="m-0 text-[19px] leading-[1.55] text-(--ink2)">
                Type it the way you’d ask a teammate. You get one clear
                explanation built on your own project, and the next thing worth
                knowing.
              </p>
            </div>
            <div className="rv2 h-[56px] box-border rounded-[999px] bg-(--card) [border:1.5px_solid_var(--ln2)] flex items-center gap-[12px] p-[0_8px_0_18px] overflow-hidden">
              <svg
                className="i text-(--ink3)"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5" />
              </svg>
              <div className="flex-1 min-w-0 h-[56px] overflow-hidden">
                <div className="flex flex-col [animation:lp-rot_9s_cubic-bezier(.65,0,.35,1)_infinite]">
                  {questions.map((q, i) => (
                    <span
                      key={i}
                      className="h-[56px] flex-none flex items-center text-[17px] font-medium whitespace-nowrap overflow-hidden text-ellipsis"
                    >
                      {q}
                    </span>
                  ))}
                </div>
              </div>
              <span className="h-[40px] p-[0_16px] rounded-[999px] bg-(--act) text-(--onact) flex items-center text-[15px] font-semibold flex-none">
                Ask
              </span>
            </div>
            <div className="rv3 rounded-[22px] bg-(--card) [border:1px_solid_var(--ln)] p-[18px] flex gap-[16px] items-center">
              <svg
                className="flex-none"
                width="96"
                height="64"
                viewBox="0 0 96 64"
                aria-hidden="true"
              >
                <circle className="[fill:var(--dbM)]" cx="14" cy="32" r="10" />
                <circle className="[fill:var(--dsM)]" cx="48" cy="14" r="10" />
                <circle
                  className="[fill:none] [stroke:var(--sdS)] [stroke-width:2.5] [stroke-dasharray:4_4]"
                  cx="82"
                  cy="32"
                  r="10"
                />
                <circle className="[fill:var(--rvM)]" cx="48" cy="50" r="10" />
                <path
                  className="[fill:none] [stroke:var(--ink3)] [stroke-width:2]"
                  d="M22 27 40 18M22 37 40 46M56 18 74 27"
                />
                <path
                  className="[fill:none] [stroke:var(--sdS)] [stroke-width:2.5] [stroke-dasharray:3_4]"
                  d="M56 46 74 37"
                />
              </svg>
              <div className="flex flex-col gap-[4px] min-w-0">
                <span className="text-[13px] font-semibold text-(--ink3)">
                  A gap worth closing · 4 min
                </span>
                <span className="text-[17px] leading-[1.4] font-medium">
                  You know indexes and caching. The missing link is{" "}
                  <b className="font-bold">write amplification</b>.
                </span>
              </div>
            </div>
          </div>
          <div className="rv2 flex-[1_1_520px] min-w-0 flex justify-center">
            <div className="scn w-[560px] h-[520px] max-[720px]:mb-[-208px]">
              <div className="wld spin top-[62%]">
                <div className="floor w-[480px] h-[480px]" />
                {mapBoxes.map((b, i) => (
                  <div key={i} className="bx" style={{ ...b.st }}>
                    <span className="ft">{b.label}</span>
                    <span className="bk"></span>
                    <span className="rt"></span>
                    <span className="lf"></span>
                    <span className="tp"></span>
                    <span className="bt"></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
      <section
        className="max-w-[1200px] mx-auto p-[120px_32px] flex flex-wrap-reverse items-center gap-[40px]"
        id="paths"
      >
        <div className="rv2 flex-[1_1_520px] min-w-0 flex justify-center">
          <div className="scn w-[560px] h-[480px] max-[720px]:mb-[-192px]">
            <div className="wld sway2 top-[70%]">
              <div className="floor w-[520px] h-[520px]" />
              {books.map((b, i) => (
                <div key={i} className="bx" style={{ ...b.st }}>
                  <span className="ft flex-col justify-between p-[12px_0]">
                    <span className="w-[60%] h-[4px] rounded-[2px] bg-[#101217] opacity-[0.5]"></span>
                    <span className="[writing-mode:vertical-rl] [transform:rotate(180deg)] text-[12px] font-bold tracking-[0.01em] whitespace-nowrap overflow-hidden max-h-[76%]">
                      {b.t}
                    </span>
                    <span className="w-[60%] h-[4px] rounded-[2px] bg-[#101217] opacity-[0.5]"></span>
                  </span>
                  <span className="bk"></span>
                  <span className="rt"></span>
                  <span className="lf"></span>
                  <span className="tp"></span>
                  <span className="bt"></span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex-[1_1_420px] min-w-0 flex flex-col gap-[22px]">
          <div className="rv flex flex-col gap-[14px]">
            <span className="text-[14px] font-semibold text-(--ink3)">
              03 · Books
            </span>
            <h2 className="m-0 text-[length:clamp(36px,4.4vw,56px)] leading-[1.02] font-bold tracking-[-0.04em]">
              Big books, cut into breaks.
            </h2>
            <p className="m-0 text-[19px] leading-[1.55] text-(--ink2)">
              Pick the book you keep meaning to finish. Interval splits it into
              short sessions with a checkpoint after each chapter, and tells you
              when you’ll be done.
            </p>
          </div>
          <div className="rv3 rounded-[24px] bg-(--card) [border:1px_solid_var(--ln)] [box-shadow:var(--shadow)] p-[20px] flex flex-col gap-[14px]">
            <div className="flex justify-between gap-[12px] items-baseline flex-wrap">
              <span className="text-[18px] font-bold tracking-[-0.015em]">
                Designing Data-Intensive Applications
              </span>
              <span className="n text-[14px] text-(--ink3)">18 of 42</span>
            </div>
            <div
              className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-[4px]"
              aria-hidden="true"
            >
              {segs.map((g, i) => (
                <span
                  key={i}
                  className="h-[10px] rounded-[3px] bg-(--sf2) overflow-hidden flex"
                >
                  <span
                    className="flex-1 rounded-[3px] bg-(--go) [transform-origin:0_50%]"
                    style={{ ...g.st }}
                  ></span>
                </span>
              ))}
            </div>
            <span className="text-[15px] text-(--ink2)">
              About 6 minutes a session · finishing around{" "}
              <b className="font-semibold text-(--ink)">Dec 14</b>
            </span>
            <div className="flex flex-col">
              {chapters.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-[12px] min-h-[48px] [border-top:1px_solid_var(--ln)]"
                >
                  <span
                    className="w-[10px] h-[10px] rounded-[3px]"
                    style={{ background: c.c }}
                  ></span>
                  <span className="flex-1 text-[16px] font-medium">{c.t}</span>
                  <span className="n text-[14px] text-(--ink3)">{c.s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section
        className="max-w-[1200px] mx-auto p-[0_32px_120px] flex flex-wrap items-center gap-[40px]"
        id="listen"
      >
        <div className="rv flex-[1_1_380px] min-w-0 flex flex-col gap-[14px]">
          <span className="text-[14px] font-semibold text-(--ink3)">
            04 · Listen
          </span>
          <h2 className="m-0 text-[length:clamp(36px,4.4vw,56px)] leading-[1.02] font-bold tracking-[-0.04em]">
            Hands busy? Put it in your ears.
          </h2>
          <p className="m-0 text-[19px] leading-[1.55] text-(--ink2)">
            Any article or chapter becomes a short episode, with a live
            transcript and a diagram that follows along. Save a moment without
            stopping.
          </p>
        </div>
        <ListenPlayer />
      </section>
      <section className="p-[0_20px]" id="play">
        <div className="max-w-[1280px] mx-auto rounded-[40px] bg-(--sunM) text-[#101217] p-[100px_32px] box-border">
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[44px]">
            <div className="rv flex flex-wrap items-end justify-between gap-[24px]">
              <div className="flex-[1_1_560px] min-w-0 flex flex-col gap-[14px]">
                <span className="text-[14px] font-semibold text-[#3A2E0A]">
                  05 · Play
                </span>
                <h2 className="m-0 text-[length:clamp(36px,4.4vw,56px)] leading-[1.02] font-bold tracking-[-0.04em]">
                  Quick games, built from what you read.
                </h2>
                <p className="m-0 text-[19px] leading-[1.55] text-[#2B2410] max-w-[640px]">
                  Two minutes against someone at your level. Every question
                  comes from articles and books you both studied this week, and
                  every match ends with the one answer you missed.
                </p>
              </div>
              <Link
                className="h-[56px] p-[0_26px] rounded-[999px] bg-[#101217] text-[#FFFFFF] flex items-center gap-[10px] text-[17px] font-semibold no-underline flex-none"
                href="/join"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path className="[fill:currentColor]" d="M7 4.5v15l12-7.5z" />
                </svg>
                Find a match
              </Link>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[16px]">
              <div className="rv rounded-[28px] bg-[#FFFFFF] p-[22px] flex flex-col gap-[14px]">
                <span className="flex items-center gap-[10px]">
                  <span className="n w-[30px] h-[30px] rounded-[99px] bg-[#101217] text-[#FFFFFF] flex items-center justify-center text-[14px] font-bold">
                    1
                  </span>
                  <span className="text-[20px] font-bold tracking-[-0.02em]">
                    Get matched
                  </span>
                </span>
                <div
                  className="h-[200px] rounded-[20px] bg-[#FFF3CC] flex items-center justify-center gap-[16px] overflow-hidden"
                  aria-hidden="true"
                >
                  <span className="w-[76px] h-[76px] rounded-[99px] bg-[#101217] text-[#FFFFFF] flex items-center justify-center text-[22px] font-extrabold [animation:lp-mL_5s_cubic-bezier(.2,.8,.2,1)_infinite]">
                    AK
                  </span>
                  <span className="w-[46px] h-[46px] rounded-[14px] bg-[#FF6A55] flex items-center justify-center text-[16px] font-extrabold [animation:lp-vsPop_5s_cubic-bezier(.2,.8,.2,1)_infinite]">
                    vs
                  </span>
                  <span className="w-[76px] h-[76px] rounded-[99px] bg-[#FFFFFF] [border:3px_solid_#101217] box-border flex items-center justify-center text-[22px] font-extrabold [animation:lp-mR_5s_cubic-bezier(.2,.8,.2,1)_infinite]">
                    RS
                  </span>
                </div>
                <span className="text-[17px] leading-[1.5] text-[#2B2A33]">
                  Someone at your level, usually in seconds. A bot fills in if
                  nobody’s around, and it says so.
                </span>
              </div>
              <div className="rv2 rounded-[28px] bg-[#FFFFFF] p-[22px] flex flex-col gap-[14px]">
                <span className="flex items-center gap-[10px]">
                  <span className="n w-[30px] h-[30px] rounded-[99px] bg-[#101217] text-[#FFFFFF] flex items-center justify-center text-[14px] font-bold">
                    2
                  </span>
                  <span className="text-[20px] font-bold tracking-[-0.02em]">
                    Race the question
                  </span>
                </span>
                <div className="rounded-[20px] bg-[#F3F4F6] p-[14px] flex flex-col gap-[10px]">
                  <div className="flex items-center gap-[10px]">
                    <span className="n text-[22px] font-extrabold tracking-[-0.03em]">
                      3 – 2
                    </span>
                    <span className="n text-[13px] text-[#454A55]">
                      Round 6 of 7
                    </span>
                    <svg
                      className="ml-auto [transform:rotate(-90deg)]"
                      width="34"
                      height="34"
                      viewBox="0 0 36 36"
                      aria-hidden="true"
                    >
                      <circle
                        className="[fill:none] [stroke:#E6E8EC] [stroke-width:4]"
                        cx="18"
                        cy="18"
                        r="15"
                      />
                      <circle
                        className="[fill:none] [stroke:#101217] [stroke-width:4] [stroke-linecap:round] [stroke-dasharray:100] [animation:lp-ring_6s_linear_infinite]"
                        cx="18"
                        cy="18"
                        r="15"
                        pathLength="100"
                      />
                    </svg>
                  </div>
                  <div
                    className="h-[10px] rounded-[5px] bg-[#FFD9D3] overflow-hidden flex"
                    aria-hidden="true"
                  >
                    <span className="h-full bg-[#101217] rounded-[5px] [animation:lp-tug_6s_ease-in-out_infinite]"></span>
                  </div>
                  <span className="text-[16px] leading-[1.4] font-semibold">
                    A user updates their email, refreshes, and sees the old one.
                    Most likely cause?
                  </span>
                  <span className="min-h-[44px] p-[8px_12px] box-border rounded-[12px] [border:2px_solid_#12A150] bg-[#DDF5E7] text-[#0B7A3E] flex items-center gap-[8px] text-[15px] font-semibold">
                    <svg
                      className="i [stroke-width:2.6]"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                    Read hit a lagging replica
                  </span>
                  <span className="min-h-[44px] p-[8px_12px] box-border rounded-[12px] [border:1.5px_solid_#CDD1D8] bg-[#FFFFFF] flex items-center text-[15px] font-medium">
                    Stale CDN cache
                  </span>
                </div>
                <span className="text-[17px] leading-[1.5] text-[#2B2A33]">
                  Seven rounds, first to four. A wrong tap freezes you for two
                  seconds, so knowing beats guessing.
                </span>
              </div>
              <div className="rv3 rounded-[28px] bg-[#FFFFFF] p-[22px] flex flex-col gap-[14px]">
                <span className="flex items-center gap-[10px]">
                  <span className="n w-[30px] h-[30px] rounded-[99px] bg-[#101217] text-[#FFFFFF] flex items-center justify-center text-[14px] font-bold">
                    3
                  </span>
                  <span className="text-[20px] font-bold tracking-[-0.02em]">
                    Climb your league
                  </span>
                </span>
                <div className="rounded-[20px] bg-[#F3F4F6] overflow-hidden flex flex-col">
                  <div className="scn w-full h-[150px]">
                    <div className="wld sway top-[84%]">
                      {podiumS.map((b, i) => (
                        <div key={i} className="bx" style={{ ...b.st }}>
                          <span className="ft text-[26px]">{b.label}</span>
                          <span className="bk"></span>
                          <span className="rt"></span>
                          <span className="lf"></span>
                          <span className="tp"></span>
                          <span className="bt"></span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-[0_8px_8px] flex flex-col gap-[2px]">
                    {ladder.map((r, i) => (
                      <Fragment key={i}>
                        {r.line && (
                          <span className="flex items-center gap-[8px] text-[11px] font-bold tracking-[0.08em] text-[#0B7A3E] p-[3px_10px]">
                            <span className="flex-1 [border-top:2px_dashed_#12A150]"></span>
                            TOP 7 MOVE UP
                            <span className="flex-1 [border-top:2px_dashed_#12A150]"></span>
                          </span>
                        )}
                        {r.row && (
                          <span
                            className="h-[36px] p-[0_12px] rounded-[10px] flex items-center gap-[12px] text-[15px]"
                            style={{ ...r.st }}
                          >
                            <span className="n w-[20px] font-bold">{r.p}</span>
                            <span className="flex-1">{r.n}</span>
                            {r.you && (
                              <span className="n pulse h-[22px] p-[0_8px] rounded-[99px] bg-[#35D07F] text-[#101217] flex items-center text-[12px] font-bold">
                                up 3
                              </span>
                            )}
                            <span className="n font-bold">{r.s}</span>
                          </span>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </div>
                <span className="text-[17px] leading-[1.5] text-[#2B2A33]">
                  30 people at your pace, one week. The top 7 move up, and you
                  can see the line.
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-[14px]">
              <span className="rv text-[15px] font-semibold text-[#3A2E0A]">
                Pick your game
              </span>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-[12px]">
                {games.map((g, i) => (
                  <Link
                    key={i}
                    className={`${g.rv} relative h-[150px] box-border rounded-[24px] text-[#101217] p-[18px] flex flex-col gap-[4px] no-underline overflow-hidden [border:2px_solid_#101217]`}
                    href="/join"
                    style={{ background: g.bg }}
                  >
                    <span className="text-[20px] font-bold tracking-[-0.02em]">
                      {g.t}
                    </span>
                    <span className="text-[14px] font-medium max-w-[150px]">
                      {g.d}
                    </span>
                    <span
                      className="absolute right-[16px] bottom-[14px] w-[52px] h-[52px] rounded-[16px] bg-[#101217] text-[#FFFFFF] flex items-center justify-center [animation:lp-flt_4s_ease-in-out_infinite]"
                      style={{ ...g.delay }}
                    >
                      <svg
                        className="i"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d={g.icon} />
                      </svg>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="p-[120px_20px_0]" id="battles">
        <div className="max-w-[1280px] mx-auto rounded-[40px] bg-[#0E1014] text-[#F3F4F6] p-[100px_32px] box-border overflow-clip">
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[64px]">
            <div className="rv flex flex-col gap-[14px] max-w-[800px]">
              <span className="text-[14px] font-semibold text-[#8F95A1]">
                06 · Design battles · on the web
              </span>
              <h2 className="m-0 text-[length:clamp(38px,4.8vw,64px)] leading-[1] font-bold tracking-[-0.045em]">
                Design a system against someone else. Live.
              </h2>
              <p className="m-0 text-[19px] leading-[1.55] text-[#BCC1CB]">
                Draw the architecture and watch real traffic hit it. Or write
                the code and race hidden tests before the requirements change
                under you.
              </p>
              <div className="flex gap-[8px] flex-wrap pt-[6px]">
                <span className="h-[34px] p-[0_14px] rounded-[999px] bg-[#1A1D23] flex items-center text-[14px] font-semibold">
                  HLD · 30 min
                </span>
                <span className="h-[34px] p-[0_14px] rounded-[999px] bg-[#1A1D23] flex items-center text-[14px] font-semibold">
                  LLD · 45 min
                </span>
                <span className="h-[34px] p-[0_14px] rounded-[999px] bg-[#1A1D23] flex items-center text-[14px] font-semibold">
                  1v1 or solo
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-[28px]">
              <div className="rv2 flex-[1_1_620px] min-w-0 flex justify-center relative">
                <span className="absolute left-0 top-0 z-[2] h-[34px] p-[0_12px] rounded-[999px] bg-[#1A1D23] flex items-center gap-[8px] text-[13px] font-semibold">
                  <span className="pulse w-[8px] h-[8px] rounded-[9px] bg-[#35D07F]"></span>
                  HLD battle · traffic is live
                </span>
                <span className="pulse absolute right-0 top-0 z-[2] h-[34px] p-[0_12px] rounded-[999px] bg-[#F2B92E] text-[#101217] flex items-center text-[13px] font-bold">
                  10× read spike incoming
                </span>
                <div className="scn w-[660px] h-[540px] max-[720px]:mb-[-216px]">
                  <div className="wld sway top-[60%]">
                    <div className="floor w-[640px] h-[640px] [background-color:#15181D] [background-image:linear-gradient(#23272F_1px,transparent_1px),linear-gradient(90deg,#23272F_1px,transparent_1px)]">
                      <svg
                        className="absolute left-0 top-0"
                        width="640"
                        height="640"
                        viewBox="0 0 640 640"
                        aria-hidden="true"
                      >
                        <path
                          className="[fill:none] [stroke:#5B82F5] [stroke-width:3] [stroke-linecap:round] [stroke-dasharray:6_8] [animation:lp-dash_1.1s_linear_infinite]"
                          d="M60 320H170M170 320 280 250M170 320 280 390M280 250 410 210M280 250 420 340M280 390 420 340M420 340H540M280 390 400 470H540"
                        />
                      </svg>
                    </div>
                    {hldBoxes.map((b, i) => (
                      <div key={i} className="bx" style={{ ...b.st }}>
                        <span className="ft text-[11px] font-bold tracking-[0.02em]">
                          {b.label}
                        </span>
                        <span className="bk"></span>
                        <span className="rt"></span>
                        <span className="lf"></span>
                        <span className="tp"></span>
                        <span className="bt"></span>
                      </div>
                    ))}
                    {packets.map((b, i) => (
                      <div key={i} className="bx" style={{ ...b.st }}>
                        <span className="ft"></span>
                        <span className="bk"></span>
                        <span className="rt"></span>
                        <span className="lf"></span>
                        <span className="tp"></span>
                        <span className="bt"></span>
                      </div>
                    ))}
                    <span className="absolute left-0 top-0 whitespace-nowrap h-[30px] p-[0_10px] rounded-[999px] bg-[#FF6B72] text-[#101217] flex items-center text-[12px] font-bold [transform:translate3d(160px,-170px,20px)_rotateY(-40deg)] [animation:lp-al1_10s_linear_infinite]">
                      Replica 4s behind
                    </span>
                    <span className="absolute left-0 top-0 whitespace-nowrap h-[30px] p-[0_10px] rounded-[999px] bg-[#35D07F] text-[#101217] flex items-center text-[12px] font-bold [transform:translate3d(160px,-170px,20px)_rotateY(-40deg)] [animation:lp-al2_10s_linear_infinite] motion-reduce:hidden">
                      Reads rerouted to primary
                    </span>
                  </div>
                </div>
              </div>
              <div className="rv3 flex-[1_1_340px] min-w-0 rounded-[28px] bg-[#15181D] p-[24px] flex flex-col gap-[16px]">
                <span className="text-[20px] font-bold tracking-[-0.02em]">
                  What survives gets scored
                </span>
                <div className="flex flex-col gap-[10px]">
                  {reqs.map((q, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-[12px] text-[16px]"
                    >
                      <span
                        className="w-[26px] h-[26px] rounded-[99px] flex-none flex items-center justify-center [animation:lp-chk_10s_linear_infinite]"
                        style={{ ...q.st }}
                      >
                        <svg
                          className="i [stroke-width:3]"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path d="m5 12.5 4.5 4.5L19 7.5" />
                        </svg>
                      </span>
                      {q.t}
                    </span>
                  ))}
                </div>
                <div className="flex flex-col gap-[8px] pt-[14px] [border-top:1px_solid_#262A32]">
                  <span className="flex items-center gap-[10px] text-[14px]">
                    <span className="w-[44px] font-semibold">You</span>
                    <span className="flex-1 h-[10px] rounded-[5px] bg-[#23272F] overflow-hidden flex">
                      <span className="rounded-[5px] bg-[#35D07F] [animation:lp-vsA_10s_cubic-bezier(.2,.8,.2,1)_infinite]"></span>
                    </span>
                    <span className="n w-[28px] text-right font-bold">86</span>
                  </span>
                  <span className="flex items-center gap-[10px] text-[14px] text-[#BCC1CB]">
                    <span className="w-[44px] font-semibold">Riya</span>
                    <span className="flex-1 h-[10px] rounded-[5px] bg-[#23272F] overflow-hidden flex">
                      <span className="rounded-[5px] bg-[#FF6A55] [animation:lp-vsB_10s_cubic-bezier(.2,.8,.2,1)_infinite]"></span>
                    </span>
                    <span className="n w-[28px] text-right font-bold">79</span>
                  </span>
                </div>
                <span className="text-[15px] leading-[1.5] text-[#BCC1CB]">
                  Then you explain two choices in a few lines. The rubric scores
                  the reasoning, not the boxes.
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-stretch gap-[28px]">
              <div className="rv2 flex-[1_1_620px] min-w-0 rounded-[28px] bg-[#15181D] overflow-hidden flex flex-col">
                <div className="h-[48px] p-[0_18px] flex items-center gap-[12px] [border-bottom:1px_solid_#262A32]">
                  <span className="flex gap-[5px]" aria-hidden="true">
                    <span className="w-[9px] h-[9px] rounded-[9px] bg-[#FF6B72]"></span>
                    <span className="w-[9px] h-[9px] rounded-[9px] bg-[#F2B92E]"></span>
                    <span className="w-[9px] h-[9px] rounded-[9px] bg-[#35D07F]"></span>
                  </span>
                  <span className="mono text-[13px] text-[#BCC1CB]">
                    lru_cache.py
                  </span>
                  <span className="text-[13px] text-[#8F95A1]">
                    LLD battle · vs Riya
                  </span>
                  <span className="n ml-auto text-[15px] font-bold">31:12</span>
                </div>
                <div className="mono p-[18px_18px_22px] flex flex-col gap-[2px] text-[14px] leading-[1.75] overflow-x-auto">
                  {code.map((c, i) => (
                    <span key={i} className="flex gap-[18px] whitespace-pre">
                      <span className="n w-[20px] text-right text-[#5A616E] flex-none">
                        {c.n}
                      </span>
                      <span style={{ ...c.st }}>{c.t}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex-[1_1_340px] min-w-0 flex flex-col gap-[14px]">
                <div className="rv2 rounded-[24px] bg-[#F2B92E] text-[#101217] p-[16px_18px] flex flex-col gap-[4px] [animation:lp-twist_14s_cubic-bezier(.2,.8,.2,1)_infinite]">
                  <span className="text-[12px] font-bold tracking-[0.08em] uppercase">
                    Twist · halfway
                  </span>
                  <span className="text-[17px] font-bold leading-[1.3]">
                    Capacity is now per user, not global. Hidden tests just
                    changed.
                  </span>
                </div>
                <div className="rv3 flex-1 rounded-[28px] bg-[#15181D] p-[20px] flex flex-col gap-[12px]">
                  <span className="text-[20px] font-bold tracking-[-0.02em]">
                    Hidden tests
                  </span>
                  {tests.map((s, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-[12px] min-h-[36px]"
                    >
                      <span className="relative w-[58px] h-[26px] flex-none">
                        <span
                          className="absolute inset-0 rounded-[99px] bg-[#3A1517] text-[#FF7B82] flex items-center justify-center text-[12px] font-bold [animation:lp-tfail_14s_linear_infinite]"
                          style={{ ...s.st }}
                        >
                          fail
                        </span>
                        <span
                          className="absolute inset-0 rounded-[99px] bg-[#0F2E1E] text-[#5ADB95] flex items-center justify-center text-[12px] font-bold [animation:lp-tpass_14s_linear_infinite]"
                          style={{ ...s.st }}
                        >
                          pass
                        </span>
                      </span>
                      <span className="mono text-[13px] text-[#BCC1CB] overflow-hidden text-ellipsis whitespace-nowrap">
                        {s.t}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="rv flex gap-[10px] flex-wrap items-center">
              <Link
                className="h-[56px] p-[0_26px] rounded-[999px] bg-[#F3F4F6] text-[#0E1014] flex items-center gap-[10px] text-[17px] font-semibold no-underline"
                href="/join"
              >
                Book a battle
              </Link>
              <Link
                className="h-[56px] p-[0_24px] box-border rounded-[999px] [border:1.5px_solid_#3A3F49] text-[#F3F4F6] flex items-center text-[17px] font-semibold no-underline"
                href="/join"
              >
                Try one solo
              </Link>
              <span className="text-[15px] text-[#8F95A1] pl-[6px]">
                Book it on your phone, play it at your desk.
              </span>
            </div>
          </div>
        </div>
      </section>
      <section
        className="max-w-[1200px] mx-auto p-[120px_32px] flex flex-col gap-[32px]"
        id="make"
      >
        <div className="rv flex flex-col gap-[14px] max-w-[760px]">
          <span className="text-[14px] font-semibold text-(--ink3)">
            07 · Yours
          </span>
          <h2 className="m-0 text-[length:clamp(36px,4.4vw,56px)] leading-[1.02] font-bold tracking-[-0.04em]">
            Same minutes. Different person, different pick.
          </h2>
          <p className="m-0 text-[19px] leading-[1.55] text-(--ink2)">
            Tell it what you build and how long you have. Watch the pick change.
          </p>
        </div>
        <PickDemo />
      </section>
      <section className="max-w-[1200px] mx-auto p-[40px_32px_120px] flex flex-col gap-[32px]">
        <h2 className="rv m-0 text-[length:clamp(36px,4.4vw,56px)] leading-[1.02] font-bold tracking-[-0.04em] max-w-[760px]">
          You’ll know if this is you.
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-[16px]">
          {minds.map((k, i) => (
            <div
              key={i}
              className={`${k.rv} rounded-[26px] p-[8px_8px_22px] flex flex-col gap-[6px] overflow-hidden`}
              style={{ background: k.T }}
            >
              <div className="scn w-full h-[200px]">
                <div className={`wld ${k.anim} top-[72%]`}>
                  {k.boxes.map((b, j) => (
                    <div key={j} className="bx" style={{ ...b.st }}>
                      <span className="ft text-[44px]">{b.label}</span>
                      <span className="bk"></span>
                      <span className="rt"></span>
                      <span className="lf"></span>
                      <span className="tp"></span>
                      <span className="bt"></span>
                    </div>
                  ))}
                </div>
              </div>
              <span className="p-[0_14px] text-[22px] font-bold tracking-[-0.02em]">
                {k.t}
              </span>
              <span className="p-[0_14px] text-[16px] leading-[1.45] text-(--ink2)">
                {k.d}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="p-[0_20px_20px]">
        <div className="max-w-[1280px] mx-auto rounded-[40px] bg-[#0E1014] text-[#F3F4F6] p-[110px_32px_90px] box-border flex flex-col items-center gap-[26px] text-center">
          <h2 className="rv m-0 text-[length:clamp(40px,5.4vw,72px)] leading-[1] font-bold tracking-[-0.045em] max-w-[900px]">
            Your next gap is already on its way.
          </h2>
          <p className="rv2 m-0 text-[19px] leading-[1.55] text-[#BCC1CB] max-w-[580px]">
            Start on your phone, play on the web. Your streak, your books and
            your spot carry over.
          </p>
          <div className="rv2 flex gap-[10px] flex-wrap justify-center">
            <Link
              className="h-[56px] p-[0_26px] rounded-[999px] bg-[#F3F4F6] text-[#0E1014] flex items-center text-[17px] font-semibold no-underline"
              href="/join"
            >
              Start free
            </Link>
            <Link
              className="h-[56px] p-[0_24px] box-border rounded-[999px] [border:1.5px_solid_#3A3F49] text-[#F3F4F6] flex items-center text-[17px] font-semibold no-underline"
              href="/"
            >
              Open the web app
            </Link>
          </div>
          <div
            className="rv3 w-full max-w-[760px] mt-[30px] relative h-[56px]"
            aria-hidden="true"
          >
            <div className="absolute left-0 right-0 bottom-[18px] h-[2px] bg-[#3A3F49]" />
            {ticks.map((k, i) => (
              <span
                key={i}
                className="absolute bottom-[18px] w-[2px] ml-[-1px] bg-[#5A616E]"
                style={{ ...k.st }}
              ></span>
            ))}
            <span className="absolute bottom-[12px] w-[14px] h-[14px] ml-[-7px] rounded-[99px] bg-[#35D07F] [animation:lp-mark_15s_linear_infinite]"></span>
            <span className="n absolute left-0 bottom-[-6px] text-[12px] text-[#8F95A1]">
              0
            </span>
            <span className="n absolute left-[20%] bottom-[-6px] text-[12px] text-[#8F95A1]">
              3
            </span>
            <span className="n absolute left-[53.3%] bottom-[-6px] text-[12px] text-[#8F95A1]">
              8
            </span>
            <span className="n absolute right-0 bottom-[-6px] text-[12px] text-[#8F95A1]">
              15 min
            </span>
          </div>
        </div>
      </section>
      <footer className="max-w-[1200px] mx-auto p-[28px_32px_40px] flex items-center gap-[20px] flex-wrap">
        <span className="flex items-center gap-[10px]">
          <span
            className="w-[28px] h-[28px] rounded-[8px] bg-(--act) flex items-center justify-center gap-[3px]"
            aria-hidden="true"
          >
            <span className="w-[4px] h-[13px] rounded-[2px] bg-(--onact)"></span>
            <span className="w-[6px] h-[6px] rounded-[9px] bg-[#35D07F] self-end mb-[7px]"></span>
          </span>
          <span className="text-[18px] font-bold tracking-[-0.02em]">
            Interval
          </span>
        </span>
        <span className="text-[15px] text-(--ink3)">
          For the minutes in between.
        </span>
        <nav className="flex gap-[4px] flex-wrap ml-auto" aria-label="Footer">
          <Link
            className="p-[10px_12px] text-[15px] text-(--ink2) no-underline"
            href="/join"
          >
            Mobile app
          </Link>
          <Link
            className="p-[10px_12px] text-[15px] text-(--ink2) no-underline"
            href="/"
          >
            Web games
          </Link>
        </nav>
      </footer>
    </div>
  );
}
