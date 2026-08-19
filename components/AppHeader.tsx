import Link from "next/link";
import { headers } from "next/headers";
import { signOutAction } from "@/app/actions";
import { createClient } from "@/lib/supabase/server";
import { detectLangFromAcceptHeader, type Lang } from "@/lib/lang";

const copy: Record<Lang, { login: string; register: string; logout: string }> = {
  nl: { login: "Inloggen", register: "Registreren", logout: "Uitloggen" },
  en: { login: "Log in", register: "Register", logout: "Log out" },
};

export async function AppHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let voornaam: string | null = null;
  let lang: Lang = "nl";

  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("voornaam, taal_voorkeur")
      .eq("email", user.email)
      .maybeSingle();

    if (profileError) {
      console.error("[AppHeader] Supabase profile lookup on 'users' failed:", {
        message: profileError.message,
        details: profileError.details,
        hint: profileError.hint,
        code: profileError.code,
      });
    }

    voornaam = profile?.voornaam ?? null;
    lang = profile?.taal_voorkeur === "en" ? "en" : "nl";
  } else {
    const headersList = await headers();
    lang = detectLangFromAcceptHeader(headersList.get("accept-language"));
  }

  const t = copy[lang];

  return (
    <header className="border-b border-teal-100 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 100 100" className="h-8 w-8 shrink-0" aria-hidden="true">
            <circle cx="50" cy="50" r="48" fill="#0d9488" />
            <path
              d="M20 50 L38 50 L45 35 L55 65 L62 50 L80 50"
              stroke="white"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-xl font-semibold text-teal-800">StaticIso</span>
        </div>

        {user ? (
          <div className="flex items-center gap-4">
            <span className="text-base font-medium text-slate-700">
              {voornaam ?? user.email}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-base font-medium text-teal-700 underline hover:text-teal-800"
              >
                {t.logout}
              </button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg border border-teal-600 px-4 py-2 text-base font-medium text-teal-700 hover:bg-teal-50"
            >
              {t.login}
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-teal-600 px-4 py-2 text-base font-medium text-white hover:bg-teal-700"
            >
              {t.register}
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
