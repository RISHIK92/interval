"use client";

import Link from "next/link";
import {
  type SyntheticEvent,
  useActionState,
  useSyncExternalStore,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AuthState } from "./form";

// Signing in and creating an account, drawn as a request through a system (design
// trial 3, owner 2026-11-27): each field lights a part of the diagram, and on submit a
// packet travels the cables. The packet is decoration; the request is the form's own
// server action, and the diagram only shows how it ended. Owner choices: no social
// sign-in, magic link, status dot or terms line (none exist), and on success the
// status shows for a second before the page moves on by itself; the whole page, card
// included, follows the app's theme, and the packet travels even with reduced motion
// on: it runs once per submit, for about a second (owner, 2026-11-27).

type Mode = "signin" | "signup";
type Action = (state: AuthState, form: FormData) => Promise<AuthState>;
type Phase = "idle" | "sending" | "ok" | "err";

// The diagram's four nodes, left to right: client (or you), edge, auth (or users), users-db.
const POINTS = [
  [150, 416],
  [320, 307],
  [500, 259],
  [640, 396],
] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CABLES_PER_SECOND = 2;
export const LANDED_MS = 1000;
// Better Auth's limit (adapters/better-auth.ts), checked again in server/accounts.ts.
const MIN_PASSWORD = 8;

type Face = {
  top: string;
  left: string;
  right: string;
  stroke: string;
  dash: string;
  ink: string;
};
const lit = (topic: string): Face => ({
  top: `var(--${topic}-top)`,
  left: `var(--${topic}-left)`,
  right: `var(--${topic}-right)`,
  stroke: "none",
  dash: "none",
  ink: "var(--ink)",
});
const STOPPED: Face = {
  top: "var(--wrong)",
  left: "var(--live)",
  right: "color-mix(in srgb, var(--live) 75%, black)",
  stroke: "none",
  dash: "none",
  ink: "var(--ink)",
};
const GHOST: Face = {
  top: "transparent",
  left: "transparent",
  right: "transparent",
  stroke: "var(--hairline-strong)",
  dash: "6 6",
  ink: "var(--ink-muted)",
};
type Cable = { color: string; dash: string };
const ON: Cable = { color: "var(--go)", dash: "none" };
const OFF: Cable = { color: "var(--hairline-strong)", dash: "2 10" };
const RED: Cable = { color: "var(--wrong)", dash: "none" };

type Line = { mark: "✓" | "…" | "›" | "·" | "✗"; node: string; text: string };

function strength(password: string): string {
  const mixed = /[A-Za-z]/.test(password) && /[^A-Za-z]/.test(password);
  if (password.length >= 12 && mixed) return "strong";
  return mixed ? "good" : "okay";
}

const INPUT =
  "h-[52px] w-full rounded-[14px] border-[1.5px] bg-page px-4 text-[17px] text-ink placeholder:text-ink-muted focus:border-select focus:shadow-[0_0_0_3px_var(--distributed-systems-tint)] focus:outline-none";
const LABEL = "font-mono text-[13px] font-semibold text-ink-soft";
const border = (bad: boolean) =>
  bad ? "border-wrong" : "border-hairline-strong";

export function RequestAuth({
  initial,
  signIn,
  create,
  createPath,
  code = "",
  reset = false,
}: {
  initial: Mode;
  signIn: Action;
  create: Action;
  createPath: string; // /join, or /sign-up for a guest
  code?: string; // an invite code from an old /join?code= link (ADR-0056)
  reset?: boolean; // arrived from a password reset
}) {
  // The server's answer moves the packet on: to the database and the next page, or
  // stopped at auth.
  const answer = useRef<(state: AuthState) => void>(() => undefined);
  const [signInState, signInAction] = useActionState<AuthState, FormData>(
    async (previous, form) => {
      const state = await signIn(previous, form);
      answer.current(state);
      return state;
    },
    null,
  );
  const [createState, createAction] = useActionState<AuthState, FormData>(
    async (previous, form) => {
      const state = await create(previous, form);
      answer.current(state);
      return state;
    },
    null,
  );
  const [mode, setMode] = useState<Mode>(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [tried, setTried] = useState(false);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const goal = useRef(0);
  const frame = useRef<number | null>(null);
  const arrived = useRef<() => void>(() => undefined);

  const signup = mode === "signup";
  const state = signup ? createState : signInState;

  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }
  useEffect(() => stop, []);

  function jump(to: number) {
    stop();
    tRef.current = to;
    setT(to);
  }

  // Moves the packet to `to` cables along, then calls `then`. A move asked for while one
  // runs takes over its goal, so the packet never jumps.
  function travel(to: number, then: () => void) {
    goal.current = to;
    arrived.current = then;
    if (frame.current !== null) return;
    let last = performance.now();
    const step = (now: number) => {
      const next = Math.min(
        goal.current,
        tRef.current + ((now - last) / 1000) * CABLES_PER_SECOND,
      );
      last = now;
      tRef.current = next;
      setT(next);
      if (next >= goal.current) {
        frame.current = null;
        arrived.current();
      } else {
        frame.current = requestAnimationFrame(step);
      }
    };
    frame.current = requestAnimationFrame(step);
  }

  useEffect(() => {
    answer.current = (state) => {
      if (state === null) return;
      if ("next" in state) {
        const next = state.next;
        travel(3, () => {
          setPhase("ok");
          window.setTimeout(() => {
            window.location.assign(next);
          }, LANDED_MS);
        });
      } else {
        travel(2, () => {
          setPhase("err");
        });
      }
    };
  });

  const emailOk = EMAIL.test(email.trim());
  const nameOk = name.trim().length > 0;
  const longEnough = password.length >= MIN_PASSWORD;
  const valid = signup
    ? nameOk && emailOk && longEnough
    : emailOk && password.length > 0;
  const ok = phase === "ok";
  const err = phase === "err";
  const sending = phase === "sending";
  const busy = sending || ok;

  // Before hydration the form's action is a client wrapper that can't run yet, so
  // submitting waits until the page is live.
  const live = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  // Editing after a refusal starts a new request. While sending or landing the fields
  // are read-only, so nothing can send a second request.
  function edit(set: (value: string) => void, value: string) {
    set(value);
    if (err) {
      setPhase("idle");
      jump(0);
    }
  }

  function pick(next: Mode) {
    if (busy || next === mode) return;
    setMode(next);
    setPhase("idle");
    setTried(false);
    jump(0);
    window.history.replaceState(
      null,
      "",
      // An old invite link's ?code= stays in the address on the way back.
      next === "signin"
        ? "/sign-in"
        : `${createPath}${code === "" ? "" : `?code=${encodeURIComponent(code)}`}`,
    );
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    if (busy || !valid) {
      event.preventDefault();
      if (!busy) setTried(true);
      return;
    }
    setTried(false);
    setPhase("sending");
    jump(0);
    travel(2, () => undefined);
  }

  const clientOn = signup ? nameOk : emailOk;
  const authOn = signup ? longEnough : password.length > 0;
  const nodes = {
    client: {
      ...(clientOn ? lit("distributed-systems") : GHOST),
      label: signup ? "you" : "client",
    },
    edge: { ...(emailOk ? lit("system-design") : GHOST), label: "edge" },
    auth: {
      ...(err ? STOPPED : authOn ? lit("review") : GHOST),
      label: signup ? "users" : "auth",
    },
    db: { ...(ok ? lit("databases") : GHOST), label: "users-db" },
  };
  const cables: Cable[] = [
    (clientOn && emailOk) || sending || ok || err ? ON : OFF,
    err ? RED : (emailOk && authOn) || sending || ok ? ON : OFF,
    ok || (sending && t > 2) ? ON : OFF,
  ];
  const seg = Math.min(2, Math.floor(t));
  const from = POINTS[seg] ?? POINTS[0];
  const to = POINTS[seg + 1] ?? from;
  const along = t - seg;
  const packet = {
    x: from[0] + (to[0] - from[0]) * along,
    y: from[1] + (to[1] - from[1]) * along,
  };

  const who = name.trim().split(" ")[0] || "there";
  const typing = (value: string) => (value === "" ? "›" : "…");
  const lines: Line[] = signup
    ? [
        {
          mark: nameOk ? "✓" : "›",
          node: "you",
          text: nameOk ? `hello, ${who}` : "waiting for your name",
        },
        {
          mark: emailOk ? "✓" : typing(email),
          node: "edge",
          text: emailOk
            ? email.trim()
            : email === ""
              ? "waiting for email"
              : "that email looks incomplete",
        },
        {
          mark: err ? "✗" : longEnough ? "✓" : typing(password),
          node: "users",
          text: err
            ? "request refused"
            : longEnough
              ? `password ${strength(password)}`
              : password === ""
                ? "waiting for password"
                : `${String(MIN_PASSWORD - password.length)} more characters`,
        },
        {
          mark: ok ? "✓" : sending ? "…" : "·",
          node: "users-db",
          text: ok
            ? "201 Created · your first session is ready"
            : sending
              ? "provisioning you"
              : "idle",
        },
      ]
    : [
        {
          mark: emailOk ? "✓" : typing(email),
          node: "client",
          text: emailOk
            ? email.trim()
            : email === ""
              ? "waiting for email"
              : "that email looks incomplete",
        },
        {
          mark: emailOk ? "✓" : "·",
          node: "edge",
          text: emailOk ? "routed to auth" : "idle",
        },
        {
          mark: err ? "✗" : password === "" ? "›" : "✓",
          node: "auth",
          text: err
            ? "401 email or password does not match"
            : password === ""
              ? "waiting for password"
              : "credentials ready",
        },
        {
          mark: ok ? "✓" : sending ? "…" : "·",
          node: "users-db",
          text: ok
            ? "200 OK · session created"
            : sending
              ? "looking you up"
              : "idle",
        },
      ];
  // Phones show one line: the step the request is on.
  const current =
    lines.find((line) => line.mark === "✗") ??
    lines.find((line) => line.mark === "›" || line.mark === "…") ??
    lines[lines.length - 1];

  let fieldError = "";
  if (tried && !valid) {
    if (signup && !nameOk) fieldError = "Add your name.";
    else if (!emailOk) fieldError = "Enter an email like name@company.com.";
    else
      fieldError = signup
        ? `Use ${String(MIN_PASSWORD)} or more characters for your password.`
        : "Enter your password.";
  }
  const nameBad = tried && signup && !nameOk;
  const emailBad = tried && !emailOk;
  const passwordBad =
    (tried && (signup ? !longEnough : password === "")) || (err && !signup);
  const refusal = err && state !== null && "message" in state ? state : null;

  const showStatus = ok || (err && !signup);
  const status = err
    ? { code: "401", note: "Stopped at auth", ink: "text-wrong" }
    : signup
      ? { code: "201", note: `Created · welcome, ${who}`, ink: "text-go" }
      : { code: "200", note: "OK · welcome back", ink: "text-go" };

  return (
    <div className="flex min-h-dvh flex-col bg-page bg-[radial-gradient(var(--hairline)_1.2px,transparent_1.2px)] bg-size-[26px_26px] text-ink">
      <header className="flex items-center px-5 pt-6 pb-2 lg:px-9 lg:py-[22px]">
        <Link
          href="/landing"
          aria-label="Interval home"
          className="flex items-center gap-2.5 text-[23px] font-bold tracking-[-0.03em]"
        >
          <span
            aria-hidden="true"
            className="flex size-[34px] items-center justify-center gap-[3px] rounded-[10px] bg-ink"
          >
            <span className="h-4 w-1 rounded-sm bg-page" />
            <span className="mb-[9px] size-[7px] self-end rounded-full bg-go" />
          </span>
          Interval
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col gap-5 px-5 pt-2 pb-6 lg:flex-row lg:flex-wrap lg:items-center lg:gap-10 lg:px-9 lg:pb-10">
        <div className="contents lg:flex lg:max-w-[470px] lg:min-w-0 lg:flex-[1_1_400px] lg:flex-col lg:gap-[22px]">
          <div className="order-1 flex flex-col gap-2.5">
            <h1 className="text-[34px] leading-[0.98] font-bold tracking-[-0.045em] lg:text-[54px]">
              {signup ? (
                "Provision yourself."
              ) : (
                <>
                  <span className="hidden lg:inline">Your session is </span>
                  <span className="lg:hidden">One request away.</span>
                  <span className="hidden lg:inline">one request away.</span>
                </>
              )}
            </h1>
            <p className="hidden font-mono text-sm text-ink-muted lg:block">
              {"// fill in the request, then watch it travel"}
            </p>
          </div>

          <div className="order-3 overflow-hidden rounded-3xl border border-hairline bg-card text-ink shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3.5">
              <span className="flex items-center gap-2 font-mono text-sm font-semibold">
                <span className="rounded-[7px] bg-go/15 px-2 py-[3px] text-xs font-bold text-go-text">
                  POST
                </span>
                {/* Where the browser really posts: a server action goes to its page. */}
                {signup ? createPath : "/sign-in"}
              </span>
              <div
                role="group"
                aria-label="Account"
                className="flex h-10 gap-[3px] rounded-xl bg-well p-[3px]"
              >
                {(
                  [
                    ["signin", "Sign in", "Sign in"],
                    ["signup", "Sign up", "Create account"],
                  ] as const
                ).map(([id, short, long]) => {
                  const on = id === mode;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        pick(id);
                      }}
                      className={`rounded-[9px] px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select ${on ? "bg-lift text-ink shadow-[0_1px_3px_rgba(16,18,23,0.14)]" : "text-ink-soft"}`}
                    >
                      <span className="lg:hidden">{short}</span>
                      <span className="hidden lg:inline">{long}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <form
              key={mode}
              action={signup ? createAction : signInAction}
              onSubmit={submit}
              noValidate
              className="flex flex-col gap-4 px-5 pt-5 pb-[22px]"
            >
              {reset && !signup ? (
                <p role="status" className="text-go-text">
                  Your password was changed. Sign in with the new one.
                </p>
              ) : null}
              {signup && code !== "" ? (
                <input type="hidden" name="code" value={code} />
              ) : null}
              {signup ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="request-name" className={LABEL}>
                    &quot;name&quot;:
                  </label>
                  <input
                    id="request-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    maxLength={80}
                    placeholder="What should we call you?"
                    value={name}
                    onChange={(event) => {
                      edit(setName, event.target.value);
                    }}
                    aria-invalid={nameBad}
                    aria-required
                    aria-describedby={nameBad ? "request-error" : undefined}
                    readOnly={busy}
                    className={`${INPUT} ${border(nameBad)}`}
                  />
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="request-email" className={LABEL}>
                  &quot;email&quot;:
                </label>
                <input
                  id="request-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => {
                    edit(setEmail, event.target.value);
                  }}
                  aria-invalid={emailBad}
                  aria-required
                  aria-describedby={emailBad ? "request-error" : undefined}
                  readOnly={busy}
                  className={`${INPUT} ${border(emailBad)}`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="request-password" className={LABEL}>
                    &quot;password&quot;:
                  </label>
                  {signup ? null : (
                    <Link
                      href="/forgot-password"
                      className="text-sm font-semibold text-ink-soft underline"
                    >
                      Forgot it?
                    </Link>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="request-password"
                    name="password"
                    type={show ? "text" : "password"}
                    autoComplete={signup ? "new-password" : "current-password"}
                    maxLength={128}
                    value={password}
                    onChange={(event) => {
                      edit(setPassword, event.target.value);
                    }}
                    aria-invalid={passwordBad}
                    aria-required
                    aria-describedby={passwordBad ? "request-error" : undefined}
                    readOnly={busy}
                    className={`${INPUT} pr-[76px] ${border(passwordBad)}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShow(!show);
                    }}

                    className="absolute top-1 right-1 h-11 rounded-[11px] px-3 text-sm font-semibold text-ink-soft focus-visible:outline-2 focus-visible:outline-select"
                  >
                    {show ? "Hide" : "Show"}
                    <span className="sr-only"> password</span>
                  </button>
                </div>
              </div>

              {fieldError === "" ? null : (
                <p
                  id="request-error"
                  role="alert"
                  className="text-[13px] font-medium text-wrong"
                >
                  {fieldError}
                </p>
              )}

              {refusal === null ? null : (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-[14px] bg-wrong/12 px-3.5 py-3"
                >
                  {signup ? (
                    <span className="text-[15px] font-semibold">
                      {refusal.message}
                    </span>
                  ) : (
                    <>
                      <span className="text-[15px] font-semibold">
                        <span className="font-mono text-wrong">401</span>{" "}
                        {refusal.message} The request stopped at auth.
                      </span>
                      <Link
                        href="/forgot-password"
                        className="flex h-10 items-center self-start rounded-full border-[1.5px] border-ink px-3.5 text-sm font-semibold"
                      >
                        Forgot your password?
                      </Link>
                    </>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={!live}
                aria-disabled={busy}
                className={`flex h-14 items-center justify-center gap-3 rounded-full text-[17px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select disabled:opacity-60 ${ok ? "bg-go text-white" : "bg-ink text-page"}`}
              >
                {ok
                  ? signup
                    ? "Setting up your first session…"
                    : "Opening Home…"
                  : sending
                    ? signup
                      ? "Creating…"
                      : "Signing in…"
                    : signup
                      ? "Create account"
                      : "Sign in"}
                {busy ? null : (
                  <span
                    aria-hidden="true"
                    className="hidden rounded-md bg-page/15 px-[7px] py-0.5 font-mono text-xs font-semibold lg:inline"
                  >
                    ⏎
                  </span>
                )}
              </button>
            </form>
          </div>
        </div>

        <section
          aria-label="Your request, live"
          className="order-2 flex min-w-0 flex-col gap-4 lg:flex-[1.5_1_520px]"
        >
          <div className="relative">
            <svg
              width="100%"
              viewBox="60 110 680 390"
              role="img"
              aria-label={
                signup
                  ? "Your sign-up request travels from you to edge, users and the users database."
                  : "Your sign-in request travels from client to edge, auth and the users database."
              }
              className="block overflow-visible"
            >
              {(
                [
                  "M150 416L320 307",
                  "M320 307L500 259",
                  "M500 259L640 396",
                ] as const
              ).map((d, i) => (
                <path
                  key={d}
                  d={d}
                  fill="none"
                  strokeWidth={5}
                  strokeLinecap="round"
                  stroke={cables[i]?.color}
                  strokeDasharray={cables[i]?.dash}
                />
              ))}
              <Cube
                face={nodes.auth}
                top="M500 130 558 159 500 188 442 159z"
                left="M442 159 500 188 500 288 442 259z"
                right="M500 188 558 159 558 259 500 288z"
              />
              <Cube
                face={nodes.edge}
                top="M320 250 394 287 320 324 246 287z"
                left="M246 287 320 324 320 344 246 307z"
                right="M320 324 394 287 394 307 320 344z"
              />
              <g
                strokeWidth={2}
                stroke={nodes.db.stroke}
                strokeDasharray={nodes.db.dash}
              >
                <path
                  d="M590 300v96a50 21 0 0 0 100 0V300"
                  fill={nodes.db.left}
                />
                <path
                  d="M590 348a50 21 0 0 0 100 0"
                  fill="none"
                  stroke={nodes.db.right}
                  strokeWidth={3}
                  strokeDasharray="none"
                />
                <ellipse
                  cx="640"
                  cy="300"
                  rx="50"
                  ry="21"
                  fill={nodes.db.top}
                />
              </g>
              <Cube
                face={nodes.client}
                top="M150 330 202 356 150 382 98 356z"
                left="M98 356 150 382 150 442 98 416z"
                right="M150 382 202 356 202 416 150 442z"
              />
              {(
                [
                  [nodes.client, 150, 474],
                  [nodes.edge, 320, 374],
                  [nodes.auth, 500, 314],
                  [nodes.db, 640, 446],
                ] as const
              ).map(([node, x, y]) => (
                <text
                  key={node.label}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  className="font-mono text-[15px] font-semibold"
                  fill={node.ink}
                >
                  {node.label}
                </text>
              ))}
              <circle
                cx={packet.x.toFixed(1)}
                cy={packet.y.toFixed(1)}
                r={8}
                fill={err ? "var(--wrong)" : "var(--go)"}
                opacity={sending || err ? 1 : 0}
              />
              <circle
                cx={packet.x.toFixed(1)}
                cy={packet.y.toFixed(1)}
                r={17.6}
                fill="none"
                strokeWidth={2}
                stroke={err ? "var(--wrong)" : "var(--go)"}
                opacity={sending ? 0.4 : 0}
              />
            </svg>
            <div
              aria-live={err ? "off" : "polite"}
              className="absolute top-0 left-0 flex flex-col gap-1 font-mono"
            >
              {showStatus ? (
                <>
                  <span
                    className={`text-[44px] leading-none font-bold tracking-[-0.04em] lg:text-[64px] ${status.ink}`}
                  >
                    {status.code}
                  </span>
                  <span className="text-sm text-ink-soft">{status.note}</span>
                </>
              ) : null}
            </div>
          </div>

          <div
            role="log"
            aria-label="Request log"
            aria-live="off"
            className="flex flex-col gap-1.5 rounded-[18px] border border-hairline-strong bg-card px-4 py-3.5 font-mono text-[13px] leading-[1.4]"
          >
            {lines.map((line) => (
              <LogLine
                key={line.node}
                line={line}
                phoneHidden={line !== current}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function noSubscribe(): () => void {
  return () => undefined;
}

function Cube({
  face,
  top,
  left,
  right,
}: {
  face: Face;
  top: string;
  left: string;
  right: string;
}) {
  return (
    <g
      strokeWidth={2}
      strokeLinejoin="round"
      stroke={face.stroke}
      strokeDasharray={face.dash}
    >
      <path d={top} fill={face.top} />
      <path d={left} fill={face.left} />
      <path d={right} fill={face.right} />
    </g>
  );
}

const MARK_INK: Record<Line["mark"], string> = {
  "✓": "text-go-text",
  "✗": "text-wrong",
  "›": "text-ink",
  "…": "text-ink-muted",
  "·": "text-ink-muted",
};

function LogLine({ line, phoneHidden }: { line: Line; phoneHidden: boolean }) {
  return (
    <div
      className={`gap-2.5 ${phoneHidden ? "hidden lg:flex" : "flex"} ${line.mark === "·" ? "text-ink-muted" : "text-ink-soft"}`}
    >
      <span className={`w-3 flex-none ${MARK_INK[line.mark]}`}>
        {line.mark}
      </span>
      <span className="w-[76px] flex-none text-ink-muted">{line.node}</span>
      <span className="min-w-0 truncate">{line.text}</span>
    </div>
  );
}
