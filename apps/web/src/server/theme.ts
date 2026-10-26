// Light, dark, or the device's own setting, chosen per device (owner, 2026-10-26): a
// cookie, never account data.
export const THEME_COOKIE = "iv_theme";
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(value: string | undefined): Theme {
  return THEMES.find((theme) => theme === value) ?? "system";
}
