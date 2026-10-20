export type Lang = "nl" | "en";

/** Returns the language from a URL parameter such as ?lang=en, or null when missing or invalid. */
export function parseLang(value: string | string[] | null | undefined): Lang | null {
  return value === "nl" || value === "en" ? value : null;
}

export function detectLangFromAcceptHeader(acceptLanguage: string | null): Lang {
  const primary = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  return primary.startsWith("en") ? "en" : "nl";
}
