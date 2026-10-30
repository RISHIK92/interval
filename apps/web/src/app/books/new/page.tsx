import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  entitlements,
  preferences,
  sessionReader,
} from "../../../server/container";
import { TabBar } from "../../TabBar";
import { Card } from "../../ui/Card";

export const dynamic = "force-dynamic";

// §5F, Q-P2-34, Q-P2-38 (P2-W11-S01): add a PDF book. It stays private; the notice says
// what leaves for the AI providers before anything is sent.
export default async function NewBookPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play; the rest is for accounts.
  if (actor.isGuest) redirect("/sign-up");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const { error } = await props.searchParams;
  // OPS-3: the plan's limits, as the upload checks them (null: no limit).
  const [maxMb, count] = await Promise.all([
    entitlements().limit(actor.userId, "books.max_mb"),
    entitlements().limit(actor.userId, "books.count"),
  ]);
  const errors: Record<string, string> = {
    not_pdf: "That file isn't a PDF.",
    too_large: `That PDF is over ${String(maxMb)} MB.`,
    limit: `You have ${String(count)} books, the most for now. Delete one to add another.`,
  };
  const message = error === undefined ? null : (errors[error] ?? null);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-[52rem] lg:pt-10 lg:pl-64">
      <TabBar current="paths" firstName={chosen.firstName} />
      <h1 className="text-display">Add a book</h1>
      <Card className="flex flex-col gap-4 p-5">
        <p className="text-ink-muted">
          Upload a PDF you&apos;re allowed to use. We split it into chapters and
          short sessions.{" "}
          {maxMb === null
            ? "Protected (DRM) PDFs can't be read."
            : `Up to ${String(maxMb)} MB; protected (DRM) PDFs can't be read.`}
        </p>
        <p className="text-sm">
          Your PDF stays private. Checkpoints send a chapter&apos;s text to our
          AI providers to write questions.
        </p>
        {message === null ? null : (
          <p role="alert" className="text-sm font-semibold text-wrong">
            {message}
          </p>
        )}
        <form
          action="/api/books"
          method="post"
          encType="multipart/form-data"
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-2 font-semibold">
            PDF file
            <input
              type="file"
              name="file"
              accept="application/pdf,.pdf"
              required
              className="text-sm font-normal"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
            >
              Upload
            </button>
            <Link href="/paths" className="text-sm font-semibold text-select">
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </main>
  );
}
