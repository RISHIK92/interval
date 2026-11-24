// Q-WD-17 (owner, 2026-11-23): a battle player's points on the results page, with what
// their hints took off them ("Hints: −40"), already off the total.
export function Points({
  total,
  hintCost,
}: {
  total: number;
  hintCost: number;
}) {
  return (
    <>
      {total}
      {hintCost > 0 ? (
        <span className="ml-1.5 text-xs font-normal text-ink-muted">
          Hints: −{hintCost}
        </span>
      ) : null}
    </>
  );
}
