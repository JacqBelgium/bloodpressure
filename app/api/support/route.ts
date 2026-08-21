import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import type { Lang } from "@/lib/lang";

const NOT_FOUND_MARKER = "NIET_GEVONDEN";

type FaqRow = {
  question_nl: string;
  answer_nl: string;
  question_en: string;
  answer_en: string;
};

const copy: Record<Lang, { escalated: string }> = {
  nl: {
    escalated:
      "Ik weet het antwoord niet zeker, ik heb je vraag doorgestuurd naar onze beheerder. Je krijgt persoonlijk antwoord per e-mail.",
  },
  en: {
    escalated:
      "I'm not sure of the answer, so I've forwarded your question to our administrator. You'll get a personal reply by email.",
  },
};

function buildSystemPrompt(faqRows: FaqRow[], lang: Lang): string {
  const faqText = faqRows
    .map(
      (row, i) =>
        `${i + 1}.\nNL — Q: ${row.question_nl}\nNL — A: ${row.answer_nl}\nEN — Q: ${row.question_en}\nEN — A: ${row.answer_en}`,
    )
    .join("\n\n");

  return `You are a support assistant for StaticIso, a web app offering weekly isometric exercises against high blood pressure.

Answer the user's question using ONLY the information contained in the FAQ below. Never invent, guess, or infer an answer that is not directly supported by the FAQ content.

If the FAQ does not cover the question, respond with exactly this marker and nothing else: ${NOT_FOUND_MARKER}

The user's preferred language is "${lang}". Answer in that language when possible; if the question is clearly written in a different language, answer in the language of the question instead.

FAQ:
${faqText}`;
}

export async function POST(request: NextRequest) {
  let body: { message?: string; lang?: string; userEmail?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ status: "error", message: "Missing 'message'" }, { status: 400 });
  }

  const lang: Lang = body.lang === "en" ? "en" : "nl";

  // The client-supplied userEmail is just a UI hint; the actual logged-in
  // session (if any) is the source of truth for who asked the question.
  let userEmail = body.userEmail?.trim() || null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.email) {
    userEmail = user.email;
  }

  // Publicly readable, so the regular (cookie/publishable-key) client is
  // used rather than the admin client.
  const { data: faqRows, error: faqError } = await supabase
    .from("support_faq")
    .select("question_nl, answer_nl, question_en, answer_en");

  if (faqError) {
    console.error("[support] Failed to fetch support_faq:", {
      message: faqError.message,
      details: faqError.details,
      hint: faqError.hint,
      code: faqError.code,
    });
    return NextResponse.json({ status: "error", message: faqError.message }, { status: 500 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[support] ANTHROPIC_API_KEY is not set in this environment");
    return NextResponse.json(
      { status: "error", message: "Support assistant is not configured" },
      { status: 500 },
    );
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let answerText: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: buildSystemPrompt(faqRows ?? [], lang),
      messages: [{ role: "user", content: message }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    answerText = textBlock?.text.trim() ?? "";
  } catch (err) {
    console.error("[support] Anthropic API call failed:", err);
    return NextResponse.json(
      { status: "error", message: "Failed to get a response from the support assistant" },
      { status: 500 },
    );
  }

  const escalated = !answerText || answerText.includes(NOT_FOUND_MARKER);

  if (escalated) {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.error("[support] ADMIN_EMAIL is not set; cannot notify admin of escalated question");
    } else {
      try {
        await sendEmail({
          to: { email: adminEmail, name: "Beheerder" },
          subject: `Support-vraag zonder antwoord in FAQ${userEmail ? ` (${userEmail})` : ""}`,
          htmlBody: `
            <div style="font-family: sans-serif; color: #1e293b; line-height: 1.6;">
              <p>Er is een supportvraag binnengekomen die niet met de FAQ beantwoord kon worden:</p>
              <p><strong>Vraag:</strong> ${escapeHtml(message)}</p>
              <p><strong>Van:</strong> ${userEmail ? escapeHtml(userEmail) : "onbekend (niet ingelogd)"}</p>
            </div>
          `,
          // So clicking "Reply" in the admin's mail client goes straight to
          // the person who asked, not to the noreply sender address.
          replyTo: userEmail ? { email: userEmail, name: userEmail } : undefined,
        });
      } catch (err) {
        console.error("[support] Failed to email admin about escalated question:", err);
      }
    }
  }

  const admin = createAdminClient();
  const { error: logError } = await admin.from("support_log").insert({
    user_email: userEmail,
    question: message,
    answer: escalated ? null : answerText,
    answered_by_faq: !escalated,
    escalated,
  });

  if (logError) {
    console.error("[support] Failed to write to support_log:", {
      message: logError.message,
      details: logError.details,
      hint: logError.hint,
      code: logError.code,
    });
  }

  if (escalated) {
    return NextResponse.json({ status: "escalated", message: copy[lang].escalated });
  }

  return NextResponse.json({ status: "answered", answer: answerText });
}
