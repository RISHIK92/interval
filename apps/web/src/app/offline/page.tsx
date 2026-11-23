import { Standalone, TITLE } from "../Standalone";

// The one page the service worker keeps (Q-P1-31): static, no session, no data.
export default function OfflinePage() {
  return (
    <Standalone className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center lg:min-h-[calc(100dvh-4.25rem)]">
      <h1 className={`text-display ${TITLE}`}>Interval</h1>
      <p className="mt-2 text-ink-muted">
        You&apos;re offline. Interval needs a connection; articles open on their
        publishers&apos; sites.
      </p>
    </Standalone>
  );
}
