// Q-P7-05 (owner, 2026-11-27): the end of a section offers a verified account a
// question to write about it; an unverified one is pointed at Profile, which sends the
// link. Home's end of section and the reader both show it.
export function WriteQuestionLink({
  offer,
  momentId,
  className,
}: {
  offer: "write" | "verify";
  momentId: string;
  className: string;
}) {
  return offer === "write" ? (
    <a href={`/questions/new?moment=${momentId}`} className={className}>
      Write a question
    </a>
  ) : (
    <a href="/profile#verify" className={className}>
      Verify your email to write questions
    </a>
  );
}
