export type Lang = "nl" | "en";

export function detectLangFromAcceptHeader(acceptLanguage: string | null): Lang {
  const primary = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  return primary.startsWith("en") ? "en" : "nl";
}
