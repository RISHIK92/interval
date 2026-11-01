import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "../../../env";
import { Card } from "../../ui/Card";
import { dotLabel, loadShare, shareText } from "./share";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ share: string }> };

// P3-W13-S06 (§6.3): a shared daily result, open to anyone with the link. Its preview
// image is opengraph-image.tsx; the base makes that image's URL absolute.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const share = await loadShare(params);
  if (share === null) return {};
  const text = shareText(share);
  const title = `Daily challenge, ${text.day}`;
  const description = [text.points, text.streak]
    .filter((line) => line !== null)
    .join(" · ");
  return {
    metadataBase: new URL(env().BETTER_AUTH_URL),
    title,
    description,
    openGraph: { title, description },
  };
}

export default async function SharePage({ params }: Props) {
  const share = await loadShare(params);
  if (share === null) notFound();
  const text = shareText(share);
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-10 pb-12">
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-ink-muted">Interval daily challenge</p>
        <p className="text-sm text-ink-muted">{text.day}</p>
        <h1 className="text-title">{text.points}</h1>
        {text.streak === null ? null : (
          <p className="font-semibold">{text.streak}</p>
        )}
        <ol className="flex gap-2 pt-2">
          {share.dots.map((dot, index) => (
            <li
              key={index}
              data-dot={dot}
              aria-label={`Question ${String(index + 1)}: ${dotLabel(dot)}`}
              className="size-5 rounded-full border-2 border-ink"
              style={{
                backgroundColor: `color-mix(in srgb, var(--ink) ${String(Math.round(dot * 100))}%, transparent)`,
              }}
            />
          ))}
        </ol>
      </Card>
      <a
        href="/play"
        className="self-center rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
      >
        Play today&apos;s challenge
      </a>
    </main>
  );
}
