import Link from "next/link";

// Q-P1-19, C-06: two tabs in Phase 1; Profile is reached from the header.
export function TabNav({ current }: { current: "home" | "library" }) {
  return (
    <nav aria-label="Main">
      <Link href="/" aria-current={current === "home" ? "page" : undefined}>
        Home
      </Link>{" "}
      <Link
        href="/library"
        aria-current={current === "library" ? "page" : undefined}
      >
        Library
      </Link>
    </nav>
  );
}
