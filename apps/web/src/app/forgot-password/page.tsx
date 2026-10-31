import { headers } from "next/headers";
import Link from "next/link";
import { isLocalRequest } from "../../server/local-request";
import { AuthForm } from "../AuthForm";
import { forgotPasswordAction } from "./actions";

export const dynamic = "force-dynamic";

const EMAIL = {
  name: "email",
  label: "Email",
  type: "email",
  autoComplete: "email",
} as const;

// ADR-0030: on this machine (no mail service yet), a new password straight away.
export default async function ForgotPasswordPage() {
  const local = isLocalRequest(await headers());
  return (
    <main className="mx-auto max-w-md px-4 pt-10 pb-12">
      <h1 className="text-display">Reset your password</h1>
      <p className="mt-2 text-ink-muted">
        {local
          ? "On this machine, choose a new password straight away."
          : "We'll email you a link that works for an hour."}
      </p>
      <AuthForm
        action={forgotPasswordAction}
        submit={local ? "Set password" : "Send reset link"}
        fields={
          local
            ? [
                EMAIL,
                {
                  name: "password",
                  label: "New password (8 to 128 characters)",
                  type: "password",
                  autoComplete: "new-password",
                },
              ]
            : [EMAIL]
        }
      />
      <p className="mt-6">
        <Link href="/sign-in" className="font-semibold underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
