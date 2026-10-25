import { db } from "../server/db";
import { getFeed } from "../server/feed";
import { MomentCard } from "./MomentCard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cards = await getFeed(db());
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
