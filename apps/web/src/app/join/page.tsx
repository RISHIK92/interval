import { headers } from "next/headers";
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
    <main>
      <h1>Join Interval</h1>
      <p>Interval is in private beta. Enter your invite code to start.</p>
      <JoinForm code={typeof code === "string" ? code : ""} />
    </main>
  );
}
