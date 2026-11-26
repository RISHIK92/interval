import type { LeagueTier } from "@interval/db";

// The design's tier marks (Leagues, web): a diamond in the tier's colour. Gold, Silver
// and Bronze are the design's own; Sapphire is its distributed-systems blue. Ruby and
// Diamond only appear unreached in the design, so they borrow the live red and the
// select blue until the owner picks theirs.
const FILL: Record<LeagueTier, string> = {
  bronze: "bg-[#b97a45]",
  silver: "bg-[#a3abb6]",
  gold: "bg-[#e0a82e]",
  sapphire: "bg-(--distributed-systems-left)",
  ruby: "bg-live",
  diamond: "bg-select",
};

export function TierMark({
  tier,
  reached = true,
  size = "small",
}: {
  tier: LeagueTier;
  reached?: boolean; // a tier above the player's is outlined
  size?: "small" | "large";
}) {
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 rotate-45 ${size === "large" ? "size-7 rounded-md" : "size-4 scale-80 rounded-[3px]"} ${reached ? FILL[tier] : "border-[1.5px] border-dashed border-hairline-strong"}`}
    />
  );
}
