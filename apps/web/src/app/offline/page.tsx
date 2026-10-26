// The one page the service worker keeps (Q-P1-31): static, no session, no data.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-display">Interval</h1>
      <p className="mt-2 text-ink-muted">
        You&apos;re offline. Interval needs a connection; articles open on their
        publishers&apos; sites.
      </p>
    </main>
  );
}
