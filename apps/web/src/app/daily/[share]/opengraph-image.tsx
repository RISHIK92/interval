import { ImageResponse } from "next/og";
import { loadShare, shareText } from "./share";

// P3-W13-S06 (§6.3): the shared result's link preview, drawn from the share alone, so
// no question can show. The image renderer reads no CSS variables: the design tokens'
// light values, inline.
export const dynamic = "force-dynamic";
export const alt = "A daily challenge result on Interval";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAGE = "#ffffff";
const INK = "#101217";
const MUTED = "#666c78";

export default async function Image({
  params,
}: {
  params: Promise<{ share: string }>;
}): Promise<Response> {
  const share = await loadShare(params);
  if (share === null) return new Response(null, { status: 404 });
  const text = shareText(share);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        background: PAGE,
        color: INK,
      }}
    >
      <div style={{ fontSize: 36, color: MUTED }}>Interval daily challenge</div>
      <div style={{ fontSize: 32, color: MUTED }}>{text.day}</div>
      <div style={{ fontSize: 120, fontWeight: 700 }}>{text.points}</div>
      {text.streak === null ? null : (
        <div style={{ fontSize: 44 }}>{text.streak}</div>
      )}
      <div style={{ display: "flex", gap: 28, marginTop: 16 }}>
        {share.dots.map((dot, index) => (
          <div
            key={index}
            data-dot={dot}
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              border: `6px solid ${INK}`,
              // An empty dot is the ring alone; an estimate's fill fades with its points.
              backgroundColor: `rgba(16, 18, 23, ${String(dot)})`,
            }}
          />
        ))}
      </div>
    </div>,
    size,
  );
}
