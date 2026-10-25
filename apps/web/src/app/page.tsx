import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { feedReader, sessionReader } from "../server/container";
import { signOutAction } from "./actions";
import { MomentCard } from "./MomentCard";

export const dynamic = "force-dynamic";

const FEED_LIMIT = 50;

export default async function HomePage() {
  // Private beta (Q-P1-24): no session, no app.
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const cards = await feedReader().list(FEED_LIMIT);
  return (
    <main>
      <h1>Interval</h1>
      {actor.isGuest ? (
        <p>
          <Link href="/sign-up">Sign up to keep your progress</Link>
        </p>
      ) : (
        <form action={signOutAction}>
          <button type="submit">Sign out</button>
        </form>
      )}
      {cards.length === 0 ? (
        <p>No moments yet.</p>
      ) : (
        cards.map((card) => <MomentCard key={card.momentId} card={card} />)
      )}
    </main>
  );
}
