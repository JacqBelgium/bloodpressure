"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { registerUser } from "./actions";

type Lang = "nl" | "en";

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
  },
};

export default function RegisterPage() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("nl");
  const [voornaam, setVoornaam] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  const t = copy[lang];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await registerUser({ voornaam, email, taalVoorkeur: lang });
      if (result.status === "error") {
        setError(t.error);
        return;
      }
      router.push("/");
    });
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-teal-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-teal-100 sm:p-10">
        <h1 className="text-3xl font-semibold text-slate-800">{t.heading}</h1>
        <p className="mt-2 text-lg text-slate-600">{t.subheading}</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div>
            <label
              htmlFor="voornaam"
              className="block text-lg font-medium text-slate-700"
            >
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
            <label
              htmlFor="email"
              className="block text-lg font-medium text-slate-700"
            >
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
            <span className="block text-lg font-medium text-slate-700">
              {t.language}
            </span>
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
    </main>
  );
}
