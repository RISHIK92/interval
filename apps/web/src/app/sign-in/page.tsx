import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionReader } from "../../server/container";
import { AuthForm } from "../AuthForm";
import { signInAction } from "./actions";

export const dynamic = "force-dynamic";

// A guest may sign in to an existing account; the guest is kept for the merge (S12).
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string | string[] }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor !== null && !actor.isGuest) redirect("/");
  const { reset } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-4 pt-10 pb-12">
      <h1 className="text-display">Sign in</h1>
      {reset === "1" ? (
        <p role="status" className="mt-2 text-go-text">
          Your password was changed. Sign in with the new one.
        </p>
      ) : null}
      <AuthForm
        action={signInAction}
        submit="Sign in"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
          },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
          },
        ]}
      />
      <p className="mt-6">
        <Link href="/forgot-password" className="font-semibold underline">
          Forgot your password?
        </Link>
      </p>
      <p className="mt-2">
        New here?{" "}
        <Link href="/join" className="font-semibold underline">
          Join with an invite code
        </Link>
      </p>
    </main>
  );
}
