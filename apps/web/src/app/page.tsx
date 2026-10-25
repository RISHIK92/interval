import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { feedReader, sessionReader } from "../server/container";
import { MomentCard } from "./MomentCard";

export const dynamic = "force-dynamic";

const FEED_LIMIT = 50;

export default async function HomePage() {
  // Private beta (Q-P1-24): no session, no app.
  if ((await sessionReader().current(await headers())) === null)
    redirect("/join");
  const cards = await feedReader().list(FEED_LIMIT);
  return (
    <main>
      <h1>Interval</h1>
      {cards.length === 0 ? (
        <p>No moments yet.</p>
      ) : (
        cards.map((card) => <MomentCard key={card.momentId} card={card} />)
      )}
    </main>
  );
}
