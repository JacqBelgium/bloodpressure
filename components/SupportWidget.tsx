"use client";

import { useState, useTransition, type FormEvent } from "react";

export type SupportWidgetLabels = {
  /** Text on the closed, floating button. */
  buttonLabel: string;
  /** Heading of the open chat panel. */
  title: string;
  /** Input placeholder. */
  placeholder: string;
  /** Send-button text. */
  sendLabel: string;
  /** aria-label for the close button. */
  closeLabel: string;
  /** Shown on the send button while a reply is pending. */
  sendingLabel: string;
  /** Shown when the request to the API fails outright (network/500). */
  errorMessage: string;
};

export type SupportWidgetProps = {
  /** Endpoint this widget POSTs { message, lang, userEmail } to. */
  apiEndpoint: string;
  /** All user-facing copy — this component has no built-in text of its own. */
  labels: SupportWidgetLabels;
  /** Passed through to the API so it can answer in the right language. */
  lang?: string;
  /** Passed through to the API so a question can be tied to a known user. */
  userEmail?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type SupportApiResponse =
  | { status: "answered"; answer: string }
  | { status: "escalated"; message: string }
  | { status: "error"; message: string };

export function SupportWidget({ apiEndpoint, labels, lang, userEmail }: SupportWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);

    startTransition(async () => {
      try {
        const res = await fetch(apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question, lang, userEmail }),
        });

        const data: SupportApiResponse = await res.json();

        if (!res.ok || data.status === "error") {
          setMessages((prev) => [...prev, { role: "assistant", content: labels.errorMessage }]);
          return;
        }

        const content = data.status === "answered" ? data.answer : data.message;
        setMessages((prev) => [...prev, { role: "assistant", content }]);
      } catch (err) {
        console.error("[SupportWidget] Request to support API failed:", err);
        setMessages((prev) => [...prev, { role: "assistant", content: labels.errorMessage }]);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-teal-600 px-5 py-3 text-base font-semibold text-white shadow-lg transition-colors hover:bg-teal-700"
      >
        <span aria-hidden="true">💬</span>
        {labels.buttonLabel}
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[28rem] w-80 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-teal-100">
      <div className="flex items-center justify-between border-b border-teal-100 bg-teal-600 px-4 py-3">
        <span className="text-base font-semibold text-white">{labels.title}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={labels.closeLabel}
          className="text-xl leading-none text-white/90 hover:text-white"
        >
          &times;
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
              message.role === "user"
                ? "ml-auto bg-teal-600 text-white"
                : "mr-auto bg-slate-100 text-slate-800"
            }`}
          >
            {message.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-100 p-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={labels.placeholder}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
        />
        <button
          type="submit"
          disabled={isPending || !input.trim()}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-teal-300"
        >
          {isPending ? labels.sendingLabel : labels.sendLabel}
        </button>
      </form>
    </div>
  );
}
