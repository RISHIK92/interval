import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionReader } from "../../server/container";
import { signInAction } from "../sign-in/actions";
import { RequestAuth } from "../RequestAuth";
import { join } from "./actions";

export const dynamic = "force-dynamic";

// Account first (ADR-0016), open to anyone (ADR-0056): no code to enter. A code from an
// invite link sent during the private beta rides along hidden and still sets its group;
// its use is spent on submit, never on a GET, so link previews and prefetching cannot
// burn it.
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  if ((await sessionReader().current(await headers())) !== null) redirect("/");
  const { code } = await searchParams;
  return (
    <RequestAuth
      initial="signup"
      signIn={signInAction}
      create={join}
      createPath="/join"
      code={typeof code === "string" ? code : ""}
    />
  );
}
