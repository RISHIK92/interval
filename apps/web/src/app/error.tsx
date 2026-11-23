"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClass } from "./ui/Button";
import { Page, PAGE_TITLE } from "./ui/Page";

// A page that failed on the server or in the browser: say so in the app's frame, with a
// retry and a way home. The error goes to the console (the client's logging); the
// server already logged its side, which the digest ties to.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("page failed", error.digest ?? "", error);
  }, [error]);
  return (
    <Page tab={null} firstName={null}>
      <div
        role="alert"
        className="flex flex-col items-start gap-4 py-10 lg:max-w-xl lg:py-16"
      >
        <p className="text-sm font-semibold text-ink-muted">Error</p>
        <h1 className={PAGE_TITLE}>Something went wrong</h1>
        <p className="text-ink-soft">
          This page couldn&apos;t load. Trying again usually works; if it
          doesn&apos;t, head home and come back in a moment.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Link href="/" className={buttonClass("secondary")}>
            Home
          </Link>
        </div>
      </div>
    </Page>
  );
}
