import Link from "next/link";
import { AuthForm } from "../AuthForm";
import { resetPasswordAction } from "./actions";

export const dynamic = "force-dynamic";

// Better Auth checks the emailed link first and arrives here with ?token=, or with
// ?error=INVALID_TOKEN when the link is unknown or expired.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  if (typeof token !== "string" || token === "") {
    return (
      <main>
        <h1>Reset your password</h1>
        <p role="alert">That reset link is invalid or has expired.</p>
        <p>
          <Link href="/forgot-password">Send a new link</Link>
        </p>
      </main>
    );
  }
  return (
    <main>
      <h1>Choose a new password</h1>
      <AuthForm
        action={resetPasswordAction}
        submit="Set password"
        fields={[
          { name: "token", label: "", type: "hidden", defaultValue: token },
          {
            name: "password",
            label: "New password (8 to 128 characters)",
            type: "password",
            autoComplete: "new-password",
          },
        ]}
      />
    </main>
  );
}
