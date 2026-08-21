import { headers } from "next/headers";
import { SupportWidget, type SupportWidgetLabels } from "@/components/SupportWidget";
import { createClient } from "@/lib/supabase/server";
import { detectLangFromAcceptHeader, type Lang } from "@/lib/lang";

const copy: Record<Lang, SupportWidgetLabels> = {
  nl: {
    buttonLabel: "Vragen?",
    title: "StaticIso support",
    placeholder: "Stel je vraag...",
    sendLabel: "Versturen",
    closeLabel: "Sluiten",
    sendingLabel: "Bezig...",
    errorMessage: "Er ging iets mis. Probeer het later opnieuw.",
  },
  en: {
    buttonLabel: "Questions?",
    title: "StaticIso support",
    placeholder: "Ask your question...",
    sendLabel: "Send",
    closeLabel: "Close",
    sendingLabel: "Sending...",
    errorMessage: "Something went wrong. Please try again later.",
  },
};

// This is the app-specific glue: it resolves the visitor's language and
// (if logged in) email, then hands generic props to the reusable
// SupportWidget. Reusing the widget elsewhere just means writing a new
// version of this file with a different API endpoint and label set.
export async function SupportWidgetContainer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let lang: Lang = "nl";

  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("taal_voorkeur")
      .eq("email", user.email)
      .maybeSingle();
    lang = profile?.taal_voorkeur === "en" ? "en" : "nl";
  } else {
    const headersList = await headers();
    lang = detectLangFromAcceptHeader(headersList.get("accept-language"));
  }

  return (
    <SupportWidget
      apiEndpoint="/api/support"
      labels={copy[lang]}
      lang={lang}
      userEmail={user?.email}
    />
  );
}
