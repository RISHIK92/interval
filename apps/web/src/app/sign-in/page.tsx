import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionReader } from "../../server/container";
import { join } from "../join/actions";
import { RequestAuth } from "../RequestAuth";
import { signUpAction } from "../sign-up/actions";
import { signInAction } from "./actions";

export const dynamic = "force-dynamic";

// A guest may sign in to an existing account; the guest is kept for the merge (S12).
// The card's switch creates an account in place: a guest's own (/sign-up), or a new one
// (/join).
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string | string[] }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor !== null && !actor.isGuest) redirect("/");
  const { reset } = await searchParams;
  const guest = actor !== null;
  return (
    <RequestAuth
      initial="signin"
      signIn={signInAction}
      create={guest ? signUpAction : join}
      createPath={guest ? "/sign-up" : "/join"}
      reset={reset === "1"}
    />
  );
}
