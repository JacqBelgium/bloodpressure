"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { registerUser } from "@/app/register/actions";
import { createClient } from "@/lib/supabase/client";
import type { Lang } from "@/lib/lang";

// How often to check, from this tab, whether the user has already
// signed in elsewhere (e.g. by opening the magic link in a new tab).
const SESSION_POLL_INTERVAL_MS = 4000;

const copy: Record<Lang, Record<string, string>> = {
  nl: {
    heading: "Welkom",
    subheading: "Wekelijkse isometrische oefeningen tegen hoge bloeddruk",
    firstName: "Voornaam",
    firstNamePlaceholder: "Bijv. Marie",
    email: "E-mailadres",
    emailPlaceholder: "naam@voorbeeld.nl",
    language: "Taalvoorkeur",
    dutch: "Nederlands",
    english: "English",
    submit: "Aanmelden",
    submitting: "Bezig...",
    error: "Er ging iets mis. Probeer het opnieuw.",
    info: "We sturen je een inloglink per e-mail. Een wachtwoord heb je niet nodig.",
    successHeading: "Bijna klaar",
    successBody:
      "We hebben je een inloglink gestuurd. Open je e-mail en klik op de link om verder te gaan.",
    continueButton: "Je bent ingelogd — klik hier om verder te gaan",
  },
  en: {
    heading: "Welcome",
    subheading: "Weekly isometric exercises against high blood pressure",
    firstName: "First name",
    firstNamePlaceholder: "E.g. Mary",
    email: "Email address",
    emailPlaceholder: "name@example.com",
    language: "Language preference",
    dutch: "Nederlands",
    english: "English",
    submit: "Register",
    submitting: "Please wait...",
    error: "Something went wrong. Please try again.",
    info: "We'll send you a login link by email. No password needed.",
    successHeading: "Almost there",
    successBody:
      "We've sent you a login link. Open your email and click the link to continue.",
    continueButton: "You're logged in — click here to continue",
  },
};

export function RegisterForm() {
  const [lang, setLang] = useState<Lang>("nl");
  const [voornaam, setVoornaam] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [sessionDetected, setSessionDetected] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // navigator.language is only available client-side; reading it here
    // (rather than in state's initializer) avoids a server/client render mismatch.
    const browserLang = navigator.language?.toLowerCase() ?? "";
    if (browserLang.startsWith("en")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLang("en");
    }
  }, []);

  useEffect(() => {
    if (!submitted) return;

    // The magic link is usually opened in a new tab, so this tab never
    // navigates on its own — poll for a session so it can offer a way
    // out of the "check your email" screen once the other tab has
    // signed in. This only flips a flag; the actual navigation happens
    // via a full page load (see handleContinue) so the header — which
    // lives in the root layout and wouldn't otherwise re-render on a
    // client-side navigation — picks up the new session too.
    const supabase = createClient();
    const interval = setInterval(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setSessionDetected(true);
        clearInterval(interval);
      }
    }, SESSION_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [submitted]);

  const t = copy[lang];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await registerUser({ voornaam, email, taalVoorkeur: lang });
      if (result.status === "error") {
        console.error("[RegisterForm] registerUser returned an error:", result.message);
        setError(t.error);
        return;
      }
      setSubmitted(true);
    });
  }

  if (submitted) {
    return (
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-teal-100 sm:p-10">
        <h1 className="text-2xl font-semibold text-slate-800">{t.successHeading}</h1>
        <p className="mt-3 text-lg text-slate-600">{t.successBody}</p>
        {sessionDetected && (
          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="mt-6 w-full rounded-xl bg-teal-600 px-4 py-3 text-lg font-semibold text-white transition-colors hover:bg-teal-700"
          >
            {t.continueButton}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-teal-100 sm:p-10">
      <h1 className="text-3xl font-semibold text-slate-800">{t.heading}</h1>
      <p className="mt-2 text-lg text-slate-600">{t.subheading}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        <div>
          <label htmlFor="voornaam" className="block text-lg font-medium text-slate-700">
            {t.firstName}
          </label>
          <input
            id="voornaam"
            type="text"
            required
            value={voornaam}
            onChange={(e) => setVoornaam(e.target.value)}
            placeholder={t.firstNamePlaceholder}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-lg font-medium text-slate-700">
            {t.email}
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.emailPlaceholder}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
          />
        </div>

        <div>
          <span className="block text-lg font-medium text-slate-700">{t.language}</span>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => setLang("nl")}
              aria-pressed={lang === "nl"}
              className={`flex-1 rounded-xl border px-4 py-3 text-lg font-medium transition-colors ${
                lang === "nl"
                  ? "border-teal-600 bg-teal-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-teal-50"
              }`}
            >
              {t.dutch}
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              aria-pressed={lang === "en"}
              className={`flex-1 rounded-xl border px-4 py-3 text-lg font-medium transition-colors ${
                lang === "en"
                  ? "border-teal-600 bg-teal-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-teal-50"
              }`}
            >
              {t.english}
            </button>
          </div>
        </div>

        <p className="text-base text-slate-500">{t.info}</p>

        {error && (
          <p role="alert" className="text-base font-medium text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-xl bg-teal-600 px-4 py-3 text-lg font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-teal-300"
        >
          {isPending ? t.submitting : t.submit}
        </button>
      </form>
    </div>
  );
}
