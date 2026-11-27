// Q-P7-05: today's (UTC) submissions left, as the form page and its thanks say it.
export function remainingText(remaining: number | null): string | null {
  if (remaining === null) return null;
  if (remaining === 0) return "That's all for today. Come back tomorrow (UTC).";
  return `You can write ${String(remaining)} more ${remaining === 1 ? "question" : "questions"} today.`;
}
