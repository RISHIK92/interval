import { redirect } from "next/navigation";
import { usernames } from "../../server/container";

// P3-W14-S05 (Q-P3-11; owner, 2026-11-02): every account has a username. A new one picks
// it straight after onboarding (which ends on the feed), an older one on its next visit
// to the feed, Profile or Play; then it goes back to where it was.
export async function requireUsername(
  userId: string,
  back: string,
): Promise<{ username: string; searchable: boolean }> {
  const found = await usernames().get(userId);
  if (found === null) redirect(`/username?next=${encodeURIComponent(back)}`);
  return found;
}
