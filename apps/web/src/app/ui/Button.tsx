import type { ButtonHTMLAttributes } from "react";

// Black pill to act, outline for the quieter choice (design system, 2026-10-26). The
// red play pill comes with Play, with dark text in dark mode for contrast.
const VARIANTS = {
  act: "bg-ink text-page",
  secondary: "border border-hairline bg-page text-ink",
} as const;

export function Button({
  variant = "act",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
}) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-full px-5 py-2.5 text-base font-semibold disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  );
}
