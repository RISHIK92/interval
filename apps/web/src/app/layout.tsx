import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { parseTheme, THEME_COOKIE } from "../server/theme";
import "./globals.css";
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
      <body className="bg-page font-sans text-body text-ink antialiased">
        <PwaSetup />
        {children}
      </body>
    </html>
  );
}
