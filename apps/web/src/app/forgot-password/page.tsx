import Link from "next/link";
import { AuthForm } from "../AuthForm";
import { forgotPasswordAction } from "./actions";

export default function ForgotPasswordPage() {
  return (
    <main>
      <h1>Reset your password</h1>
      <p>We&apos;ll email you a link that works for an hour.</p>
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
      <p>
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </main>
  );
}
