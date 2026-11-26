import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  asks,
  entitlements,
  events,
  preferences,
  sessionReader,
} from "../../../server/container";
import { SESSION_MINUTES, sessionPlan } from "../../../server/explore";
import { outHref } from "../../../server/outbound";
import { visitId } from "../../../server/visits";
import { Page, PAGE_TITLE } from "../../ui/Page";

export const dynamic = "force-dynamic";

// "Make it a 4-min session" (ADR-0046; owner, 2026-11-26): an answer's cited moments in
// prerequisite order, cut to about 4 minutes, the real total shown. Each opens its
// deep link through /out; nothing is copied (Part I §3.2).
export default async function AskSessionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play.
  if (actor.isGuest) redirect("/sign-up");
  // ADR-0036: a page answers 404 when the plan lacks its capability.
  if (!(await entitlements().can(actor.userId, "explore.ask"))) notFound();
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const id = z.uuid().safeParse((await searchParams)["question"]);
  if (!id.success) notFound();
  const found = await asks().sessionMoments(id.data, actor.userId);
  if (found === null) notFound();
  const plan = sessionPlan(found.moments, found.prerequisites);
  const total = plan.reduce((sum, m) => sum + m.minutes, 0);
  if (plan.length > 0)
    events().emit(
      "ask_session_started",
      { moment_count: plan.length, minutes: total },
      { ...actor, sessionId: visitId(await cookies()) },
    );
  return (
    <Page
      tab="explore"
      firstName={chosen.firstName}
      className="flex flex-col gap-[18px]"
    >
      <Link href="/explore" className="text-sm font-semibold text-ink-soft">
        ← Explore
      </Link>
      <h1 className={PAGE_TITLE}>
        {plan.length === 0
          ? "Nothing to read here"
          : `A ${String(SESSION_MINUTES)}-min session · ${String(total)} min`}
      </h1>
      {plan.length === 0 ? (
        <p className="text-ink-muted">
          None of the answer&apos;s sources can be opened as a section any more.
        </p>
      ) : (
        <>
          <p className="text-ink-soft">
            From the sources your answer cited, the ideas they build on first.
          </p>
          <ol className="flex flex-col">
            {plan.map((m, i) => (
              <li
                key={m.momentId}
                className="border-t border-hairline first:border-t-0"
              >
                <a
                  href={outHref({
                    itemId: m.itemId,
                    momentId: m.momentId,
                    from: "explore",
                    target: "section",
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-14 items-center gap-3 py-2.5"
                >
                  <span className="w-[18px] text-base font-bold text-ink-muted">
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="text-[15px] leading-[1.3] font-semibold">
                      {m.title}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {m.sourceName} · {m.minutes} min
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </>
      )}
    </Page>
  );
}
