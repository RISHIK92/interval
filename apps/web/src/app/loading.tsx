import { Page } from "./ui/Page";

// While a server page loads: the frame at once, and quiet blocks where a title and cards
// will be, sized like them so the page doesn't jump when it arrives.
const BLOCK = "rounded-3xl bg-well motion-safe:animate-pulse";

export default function Loading() {
  return (
    <Page tab={null} firstName={null}>
      <div role="status" className="flex flex-col gap-4 lg:gap-5">
        <span className="sr-only">Loading…</span>
        <div
          aria-hidden="true"
          className="h-9 w-48 rounded-xl bg-well motion-safe:animate-pulse lg:h-10"
        />
        <div
          aria-hidden="true"
          className="grid gap-3 sm:grid-cols-2 lg:gap-3.5"
        >
          <div className={`h-44 ${BLOCK}`} />
          <div className={`h-44 ${BLOCK}`} />
          <div className={`h-28 sm:col-span-2 ${BLOCK}`} />
        </div>
      </div>
    </Page>
  );
}
