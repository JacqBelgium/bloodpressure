"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { updateAccount } from "@/app/account/actions";
import type { Lang } from "@/lib/lang";

const copy: Record<Lang, Record<string, string>> = {
  nl: {
    heading: "Mijn account",
    email: "E-mailadres",
    firstName: "Voornaam",
    language: "Taalvoorkeur",
    dutch: "Nederlands",
    english: "English",
    save: "Opslaan",
    saving: "Bezig...",
    saved: "Wijzigingen opgeslagen.",
    error: "Er ging iets mis. Probeer het opnieuw.",
    back: "Terug naar oefening",
  },
  en: {
    heading: "My account",
    email: "Email address",
    firstName: "First name",
    language: "Language preference",
    dutch: "Nederlands",
    english: "English",
    save: "Save",
    saving: "Saving...",
    saved: "Changes saved.",
    error: "Something went wrong. Please try again.",
    back: "Back to exercise",
  },
};

export function AccountForm({
  email,
  voornaam: initialVoornaam,
  taalVoorkeur: initialTaalVoorkeur,
}: {
  email: string;
  voornaam: string;
  taalVoorkeur: Lang;
}) {
  const [lang, setLang] = useState<Lang>(initialTaalVoorkeur);
  const [voornaam, setVoornaam] = useState(initialVoornaam);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const t = copy[lang];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateAccount({ voornaam, taalVoorkeur: lang });
      if (result.status === "error") {
        console.error("[AccountForm] updateAccount returned an error:", result.message);
        setError(t.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-teal-100 sm:p-10">
      <h1 className="text-3xl font-semibold text-slate-800">{t.heading}</h1>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        <div>
          <span className="block text-lg font-medium text-slate-700">{t.email}</span>
          <p className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-lg text-slate-500">
            {email}
          </p>
        </div>

        <div>
          <label htmlFor="voornaam" className="block text-lg font-medium text-slate-700">
            {t.firstName}
          </label>
          <input
            id="voornaam"
            type="text"
            required
            value={voornaam}
            onChange={(e) => {
              setVoornaam(e.target.value);
              setSaved(false);
            }}
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
          />
        </div>

        <div>
          <span className="block text-lg font-medium text-slate-700">{t.language}</span>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => {
                setLang("nl");
                setSaved(false);
              }}
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
              onClick={() => {
                setLang("en");
                setSaved(false);
              }}
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
          {isPending ? t.saving : t.save}
        </button>

        {saved && !error && (
          <p className="text-center text-base font-medium text-teal-700">{t.saved}</p>
        )}

        <Link
          href="/"
          className="block w-full rounded-xl border border-teal-600 px-4 py-3 text-center text-lg font-medium text-teal-700 transition-colors hover:bg-teal-50"
        >
          {t.back}
        </Link>
      </form>
    </div>
  );
}
