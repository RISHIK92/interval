import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionReader } from "../../server/container";
import { signInAction } from "../sign-in/actions";
import { RequestAuth } from "../RequestAuth";
import { signUpAction } from "./actions";

export const dynamic = "force-dynamic";

// Only a guest signs up here: the guest becomes the account, keeping its saves (§5A)
// and its code and group if it has them (Q-P1-24); anyone else joins at /join.
export default async function SignUpPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  if (!actor.isGuest) redirect("/");
  return (
    <RequestAuth
      initial="signup"
      signIn={signInAction}
      create={signUpAction}
      createPath="/sign-up"
    />
  );
}
