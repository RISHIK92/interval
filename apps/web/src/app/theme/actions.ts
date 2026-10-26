"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "../../env";
import { parseTheme, THEME_COOKIE } from "../../server/theme";
import { visitCookieOptions } from "../../server/visits";
import { sameSitePath, textField } from "../form";

const YEAR_SECONDS = 365 * 24 * 60 * 60;

// The device's theme; back to the page it was set from, only ever a path on this site.
export async function setThemeAction(form: FormData): Promise<void> {
  const theme = parseTheme(textField(form, "theme"));
  (await cookies()).set(THEME_COOKIE, theme, {
    ...visitCookieOptions(env().BETTER_AUTH_URL),
    maxAge: YEAR_SECONDS,
  });
  redirect(sameSitePath(textField(form, "back"), "/"));
}
