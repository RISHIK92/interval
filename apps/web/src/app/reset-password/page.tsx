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
      <main className="mx-auto max-w-md px-4 pt-10 pb-12">
        <h1 className="text-display">Reset your password</h1>
        <p role="alert" className="mt-2 text-wrong">
          That reset link is invalid or has expired.
        </p>
        <p className="mt-6">
          <Link href="/forgot-password" className="font-semibold underline">
            Send a new link
          </Link>
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-md px-4 pt-10 pb-12">
      <h1 className="text-display">Choose a new password</h1>
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
