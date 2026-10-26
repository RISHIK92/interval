import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionReader } from "../../server/container";
import { JoinForm } from "./JoinForm";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  if ((await sessionReader().current(await headers())) !== null) redirect("/");
  const { code } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-4 pt-10 pb-12">
      <h1 className="text-display">Join Interval</h1>
      <p className="mt-2 text-ink-muted">
        Interval is in private beta. Create your account with your invite code.
      </p>
      <JoinForm code={typeof code === "string" ? code : ""} />
      <p className="mt-6">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
