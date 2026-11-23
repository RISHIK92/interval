import Link from "next/link";
import { buttonClass } from "./ui/Button";
import { Page, PAGE_TITLE } from "./ui/Page";

// A link that leads nowhere (a match that has gone, a mistyped address): say so in the
// app's frame, and lead back to Play and Home. Static: no session read.
export default function NotFound() {
  return (
    <Page tab={null} firstName={null}>
      <div className="flex flex-col items-start gap-4 py-10 lg:max-w-xl lg:py-16">
        <p className="text-sm font-semibold text-ink-muted">Not found</p>
        <h1 className={PAGE_TITLE}>This page isn&apos;t here</h1>
        <p className="text-ink-soft">
          The link may be old, or the match or page it pointed to has ended or
          moved.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link href="/play" className={buttonClass()}>
            Go to Play
          </Link>
          <Link href="/" className={buttonClass("secondary")}>
            Home
          </Link>
        </div>
      </div>
    </Page>
  );
}
