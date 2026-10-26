import type { ReactNode } from "react";
import { PwaSetup } from "./PwaSetup";

export const metadata = { title: "Interval" };

export const viewport = { themeColor: "#1f2933" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PwaSetup />
        {children}
      </body>
    </html>
  );
}
