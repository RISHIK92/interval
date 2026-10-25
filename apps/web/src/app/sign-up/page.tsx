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
    <main>
      <h1>Create your account</h1>
      <p>Keep your progress and use Interval on any device.</p>
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
      <p>
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
