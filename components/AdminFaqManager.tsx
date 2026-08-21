"use client";

import { useState, useTransition, type FormEvent } from "react";
import { addFaq, updateFaq, deleteFaq, type FaqInput, type FaqRow } from "@/app/admin/faq/actions";

const emptyForm: FaqInput = { question_nl: "", answer_nl: "", question_en: "", answer_en: "" };

export function AdminFaqManager({ initialFaqs }: { initialFaqs: FaqRow[] }) {
  const [faqs, setFaqs] = useState<FaqRow[]>(initialFaqs);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FaqInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEdit(faq: FaqRow) {
    setEditingId(faq.id);
    setError(null);
    setForm({
      question_nl: faq.question_nl,
      answer_nl: faq.answer_nl,
      question_en: faq.question_en,
      answer_en: faq.answer_en,
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      if (editingId) {
        const result = await updateFaq(editingId, form);
        if (result.status === "error") {
          console.error("[AdminFaqManager] updateFaq failed:", result.message);
          setError(result.message);
          return;
        }
        setFaqs((prev) => prev.map((f) => (f.id === editingId ? { ...form, id: editingId } : f)));
      } else {
        const result = await addFaq(form);
        if (result.status === "error") {
          console.error("[AdminFaqManager] addFaq failed:", result.message);
          setError(result.message);
          return;
        }
        setFaqs((prev) => [...prev, result.faq]);
      }
      resetForm();
    });
  }

  function handleDelete(id: string) {
    if (!window.confirm("Deze FAQ-vraag verwijderen?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteFaq(id);
      if (result.status === "error") {
        console.error("[AdminFaqManager] deleteFaq failed:", result.message);
        setError(result.message);
        return;
      }
      setFaqs((prev) => prev.filter((f) => f.id !== id));
      if (editingId === id) resetForm();
    });
  }

  return (
    <div className="mt-8 space-y-8">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-teal-100 sm:p-8"
      >
        <h2 className="text-xl font-semibold text-slate-800">
          {editingId ? "Vraag bewerken" : "Nieuwe vraag toevoegen"}
        </h2>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <label className="block text-base font-medium text-slate-700">Vraag (NL)</label>
            <textarea
              required
              rows={2}
              value={form.question_nl}
              onChange={(e) => setForm((f) => ({ ...f, question_nl: e.target.value }))}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-slate-700">Question (EN)</label>
            <textarea
              required
              rows={2}
              value={form.question_en}
              onChange={(e) => setForm((f) => ({ ...f, question_en: e.target.value }))}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-slate-700">Antwoord (NL)</label>
            <textarea
              required
              rows={4}
              value={form.answer_nl}
              onChange={(e) => setForm((f) => ({ ...f, answer_nl: e.target.value }))}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-slate-700">Answer (EN)</label>
            <textarea
              required
              rows={4}
              value={form.answer_en}
              onChange={(e) => setForm((f) => ({ ...f, answer_en: e.target.value }))}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-base font-medium text-red-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-xl bg-teal-600 px-5 py-2.5 text-base font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-teal-300"
          >
            {isPending ? "Bezig..." : editingId ? "Wijzigingen opslaan" : "Toevoegen"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-50"
            >
              Annuleren
            </button>
          )}
        </div>
      </form>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-800">
          Bestaande vragen ({faqs.length})
        </h2>
        {faqs.length === 0 && (
          <p className="text-base text-slate-600">Nog geen FAQ-vragen toegevoegd.</p>
        )}
        {faqs.map((faq) => (
          <div
            key={faq.id}
            className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-teal-100"
          >
            <p className="text-base font-semibold text-slate-800">{faq.question_nl}</p>
            <p className="mt-1 text-sm text-slate-600">{faq.answer_nl}</p>
            <p className="mt-3 text-base font-semibold text-slate-500">{faq.question_en}</p>
            <p className="mt-1 text-sm text-slate-500">{faq.answer_en}</p>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => startEdit(faq)}
                className="text-sm font-medium text-teal-700 underline hover:text-teal-800"
              >
                Bewerken
              </button>
              <button
                type="button"
                onClick={() => handleDelete(faq.id)}
                className="text-sm font-medium text-red-600 underline hover:text-red-700"
              >
                Verwijderen
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
