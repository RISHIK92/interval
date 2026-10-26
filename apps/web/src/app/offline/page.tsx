// The one page the service worker keeps (Q-P1-31): static, no session, no data.
export default function OfflinePage() {
  return (
    <main>
      <h1>Interval</h1>
      <p>
        You&apos;re offline. Interval needs a connection; articles open on their
        publishers&apos; sites.
      </p>
    </main>
  );
}
