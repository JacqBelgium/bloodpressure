"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { loginUser } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/client";
import type { Lang } from "@/lib/lang";

// How often to check, from this tab, whether the user has already
// signed in elsewhere (e.g. by opening the magic link in a new tab).
const SESSION_POLL_INTERVAL_MS = 4000;

const copy: Record<Lang, Record<string, string>> = {
  nl: {
    heading: "Inloggen",
    subheading: "We sturen je een inloglink per e-mail.",
    email: "E-mailadres",
    emailPlaceholder: "naam@voorbeeld.nl",
    submit: "Stuur inloglink",
    submitting: "Bezig...",
    error: "Er ging iets mis. Probeer het opnieuw.",
    notFoundHeading: "Nog geen account",
    notFoundBody:
      "Dit e-mailadres is nog niet bij ons bekend. Registreer je eerst om een account aan te maken.",
    notFoundLink: "Registreren",
    successHeading: "Bijna klaar",
    successBody:
      "We hebben je een inloglink gestuurd. Open je e-mail en klik op de link om verder te gaan.",
    continueButton: "Je bent ingelogd — klik hier om verder te gaan",
  },
  en: {
    heading: "Log in",
    subheading: "We'll send you a login link by email.",
    email: "Email address",
    emailPlaceholder: "name@example.com",
    submit: "Send login link",
    submitting: "Please wait...",
    error: "Something went wrong. Please try again.",
    notFoundHeading: "No account yet",
    notFoundBody:
      "We don't recognize this email address yet. Register first to create an account.",
    notFoundLink: "Register",
    successHeading: "Almost there",
    successBody:
      "We've sent you a login link. Open your email and click the link to continue.",
    continueButton: "You're logged in — click here to continue",
  },
};

export function LoginForm() {
  const [lang, setLang] = useState<Lang>("nl");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "ok" | "not_found">("idle");
  const [sessionDetected, setSessionDetected] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const browserLang = navigator.language?.toLowerCase() ?? "";
    if (browserLang.startsWith("en")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLang("en");
    }
  }, []);

  useEffect(() => {
    if (status !== "ok") return;

    // The magic link is usually opened in a new tab, so this tab never
    // navigates on its own — poll for a session so it can offer a way
    // out of the "check your email" screen once the other tab has
    // signed in. This only flips a flag; the actual navigation happens
    // via a full page load (see the continue button) so the header —
    // which lives in the root layout and wouldn't otherwise re-render
    // on a client-side navigation — picks up the new session too.
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
  }, [status]);

  const t = copy[lang];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await loginUser({ email });
      if (result.status === "error") {
        console.error("[LoginForm] loginUser returned an error:", result.message);
        setError(t.error);
        return;
      }
      setStatus(result.status);
    });
  }

  if (status === "ok") {
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

  if (status === "not_found") {
    return (
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-teal-100 sm:p-10">
        <h1 className="text-2xl font-semibold text-slate-800">{t.notFoundHeading}</h1>
        <p className="mt-3 text-lg text-slate-600">{t.notFoundBody}</p>
        <Link
          href="/register"
          className="mt-6 inline-block rounded-xl bg-teal-600 px-4 py-3 text-lg font-semibold text-white transition-colors hover:bg-teal-700"
        >
          {t.notFoundLink}
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-teal-100 sm:p-10">
      <h1 className="text-3xl font-semibold text-slate-800">{t.heading}</h1>
      <p className="mt-2 text-lg text-slate-600">{t.subheading}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
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
