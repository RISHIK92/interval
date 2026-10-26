import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { feedback, preferences, sessionReader } from "../../server/container";
import { parseTheme, THEME_COOKIE, THEMES } from "../../server/theme";
import { ChoicesFields } from "../ChoicesFields";
import { setThemeAction } from "../theme/actions";
import { Button } from "../ui/Button";
import {
  resetInferredAction,
  unhideSourceAction,
  updatePreferencesAction,
} from "./actions";

export const dynamic = "force-dynamic";

const THEME_LABELS = {
  light: "Light",
  dark: "Dark",
  system: "Device",
} as const;

// Fixed text per key: the query string picks which, never what it says.
const NOTICES: Record<string, string> = {
  choices: "Your choices are saved. Your feed updates in a moment.",
  reset: "Inferred interests reset.",
  unhidden: "Source shown again. Your feed updates in a moment.",
};
const MISSING: Record<string, string> = {
  goal: "Pick at least one goal.",
  topic: "Pick at least one topic.",
  level: "Pick a level.",
  break: "Pick a break length.",
};

// §5A ("view, edit, or reset anything inferred"), PER-1, Q-P1-36, P1-W4-S08.
export default async function ProfilePage(props: {
  searchParams: Promise<{ saved?: string; missing?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const [hidden, inferred] = await Promise.all([
    feedback().hiddenSources(actor.userId),
    feedback().inferred(actor.userId),
  ]);
  const { saved, missing } = await props.searchParams;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <main className="mx-auto max-w-xl px-4 pt-6 pb-24">
      <h1 className="text-display">Profile</h1>
      {/* This device's theme (owner, 2026-10-26); the Profile restyle places it. */}
      <form action={setThemeAction} aria-label="Appearance" className="my-4">
        <input type="hidden" name="back" value="/profile" />
        <p className="text-section">Appearance</p>
        <div className="mt-2 flex gap-2">
          {THEMES.map((option) => (
            <Button
              key={option}
              type="submit"
              name="theme"
              value={option}
              variant={option === theme ? "act" : "secondary"}
              aria-pressed={option === theme}
            >
              {THEME_LABELS[option]}
            </Button>
          ))}
        </div>
      </form>
      <p>
        <Link href="/">Back to your feed</Link>
      </p>
      {saved !== undefined && Object.hasOwn(NOTICES, saved) ? (
        <p role="status">{NOTICES[saved]}</p>
      ) : null}
      {missing !== undefined && Object.hasOwn(MISSING, missing) ? (
        <p role="alert">{MISSING[missing]}</p>
      ) : null}

      <section>
        <h2>Your choices</h2>
        <form action={updatePreferencesAction}>
          <ChoicesFields current={chosen} />
          <button type="submit">Save choices</button>
        </form>
      </section>

      <section>
        <h2>Hidden sources</h2>
        {hidden.length === 0 ? (
          <p>No hidden sources.</p>
        ) : (
          <ul>
            {hidden.map((source) => (
              <li key={source.sourceId}>
                <form action={unhideSourceAction}>
                  {source.name}{" "}
                  <input
                    type="hidden"
                    name="sourceId"
                    value={source.sourceId}
                  />
                  <button type="submit">Show again</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Inferred from your feedback</h2>
        <p>These shape your feed alongside your choices, which always win.</p>
        <h3>More like these</h3>
        <TitleList items={inferred.more} />
        <h3>Less like these</h3>
        <TitleList items={inferred.less} />
        <h3>Topics pushed down by Not interested</h3>
        {inferred.avoidedConcepts.length === 0 ? (
          <p>None.</p>
        ) : (
          <ul>
            {inferred.avoidedConcepts.map((concept) => (
              <li key={concept.slug}>{concept.name}</li>
            ))}
          </ul>
        )}
        <form action={resetInferredAction}>
          <button type="submit">Reset inferred interests</button>
        </form>
      </section>
    </main>
  );
}

function TitleList({ items }: { items: { itemId: string; title: string }[] }) {
  if (items.length === 0) return <p>None.</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item.itemId}>{item.title}</li>
      ))}
    </ul>
  );
}
