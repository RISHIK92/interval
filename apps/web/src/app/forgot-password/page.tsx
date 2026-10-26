import Link from "next/link";
import { AuthForm } from "../AuthForm";
import { forgotPasswordAction } from "./actions";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto max-w-md px-4 pt-10 pb-12">
      <h1 className="text-display">Reset your password</h1>
      <p className="mt-2 text-ink-muted">
        We&apos;ll email you a link that works for an hour.
      </p>
      <AuthForm
        action={forgotPasswordAction}
        submit="Send reset link"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
          },
        ]}
      />
      <p className="mt-6">
        <Link href="/sign-in" className="font-semibold underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
