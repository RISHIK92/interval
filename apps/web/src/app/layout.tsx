import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { parseTheme, THEME_COOKIE } from "../server/theme";
import "./globals.css";
import { Presence } from "./Presence";
import { PwaSetup } from "./PwaSetup";

export const metadata = { title: "Interval" };

// The browser chrome matches the page in each mode (design system tokens).
export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1014" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme}>
      <head>
        {/* With credentials: a tunnel that gates on a cookie (ngrok's warning page)
          otherwise answers Chrome's manifest fetch with HTML, and the PWA can't be
          installed (owner, 2026-10-26). */}
        <link
          rel="manifest"
          href="/manifest.webmanifest"
          crossOrigin="use-credentials"
        />
      </head>
      <body className="bg-page font-sans text-body text-ink antialiased">
        <PwaSetup />
        {/* P3-W17-S03 (Q-P3-16): every page counts toward being online, and hears of
          an accepted challenge; signed out, it stops at its first beat. */}
        <Presence />
        {children}
      </body>
    </html>
  );
}
