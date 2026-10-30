import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionReader } from "../../server/container";
import { AuthForm } from "../AuthForm";
import { signUpAction } from "./actions";

export const dynamic = "force-dynamic";

// Only a guest signs up: the guest becomes the account, keeping its code (Q-P1-24).
export default async function SignUpPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  if (!actor.isGuest) redirect("/");
  return (
    <main className="mx-auto max-w-md px-4 pt-10 pb-12">
      <h1 className="text-display">Create your account</h1>
      <p className="mt-2 text-ink-muted">
        Keep your games and progress, and use all of Interval on any device.
      </p>
      <AuthForm
        action={signUpAction}
        submit="Create account"
        fields={[
          { name: "name", label: "Name", type: "text", autoComplete: "name" },
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
          },
          {
            name: "password",
            label: "Password (8 to 128 characters)",
            type: "password",
            autoComplete: "new-password",
          },
        ]}
      />
      <p className="mt-6">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
