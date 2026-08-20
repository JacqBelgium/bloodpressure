import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { formatWeekRange, getIsoWeekNumber, getIsoWeekRange } from "@/lib/date";
import type { Lang } from "@/lib/lang";

const SITE_URL = "https://bloodpressure.vandersteen.be";

type Exercise = {
  titel_nl: string;
  titel_en: string;
};

const copy: Record<Lang, { subject: string; greeting: string; intro: string; cta: string }> = {
  nl: {
    subject: "Uw nieuwe oefening voor deze week",
    greeting: "Hallo",
    intro: "Uw oefening voor week",
    cta: "Bekijk de oefening",
  },
  en: {
    subject: "Your new exercise for this week",
    greeting: "Hello",
    intro: "Your exercise for week",
    cta: "View the exercise",
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtmlBody({
  voornaam,
  title,
  isoWeekNumber,
  weekRangeLabel,
  lang,
}: {
  voornaam: string;
  title: string;
  isoWeekNumber: number;
  weekRangeLabel: string;
  lang: Lang;
}): string {
  const t = copy[lang];
  const safeVoornaam = escapeHtml(voornaam);
  const safeTitle = escapeHtml(title);

  return `
    <div style="font-family: sans-serif; color: #1e293b; line-height: 1.6;">
      <p>${t.greeting} ${safeVoornaam},</p>
      <p>${t.intro} ${isoWeekNumber}, ${weekRangeLabel}:</p>
      <h2 style="color: #0d9488; margin: 16px 0;">${safeTitle}</h2>
      <p>
        <a
          href="${SITE_URL}"
          style="display: inline-block; background: #0d9488; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;"
        >
          ${t.cta}
        </a>
      </p>
    </div>
  `;
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: users, error: usersError } = await admin
    .from("users")
    .select("email, voornaam, taal_voorkeur");

  if (usersError) {
    console.error("[send-weekly-emails] Failed to fetch users:", {
      message: usersError.message,
      details: usersError.details,
      hint: usersError.hint,
      code: usersError.code,
    });
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }

  const { data: rpcData, error: rpcError } = await admin.rpc("get_current_exercise");

  if (rpcError) {
    console.error("[send-weekly-emails] Failed to fetch current exercise:", {
      message: rpcError.message,
      details: rpcError.details,
      hint: rpcError.hint,
      code: rpcError.code,
    });
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const exercise = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | Exercise
    | null
    | undefined;

  if (!exercise) {
    console.error("[send-weekly-emails] No current exercise available");
    return NextResponse.json({ error: "No current exercise available" }, { status: 500 });
  }

  const now = new Date();
  const isoWeekNumber = getIsoWeekNumber(now);
  const { start, end } = getIsoWeekRange(now);

  let sent = 0;
  const failures: { email: string; reason: string }[] = [];

  for (const user of users ?? []) {
    const lang: Lang = user.taal_voorkeur === "en" ? "en" : "nl";
    const weekRangeLabel = formatWeekRange(start, end, lang);
    const title = lang === "nl" ? exercise.titel_nl : exercise.titel_en;

    try {
      await sendEmail({
        to: { email: user.email, name: user.voornaam },
        subject: copy[lang].subject,
        htmlBody: buildHtmlBody({
          voornaam: user.voornaam,
          title,
          isoWeekNumber,
          weekRangeLabel,
          lang,
        }),
      });
      sent += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      console.error(`[send-weekly-emails] Failed to send to ${user.email}:`, reason);
      failures.push({ email: user.email, reason });
    }
  }

  const total = (users ?? []).length;
  console.error(`[send-weekly-emails] Done: ${sent} sent, ${failures.length} failed, ${total} total`);

  return NextResponse.json({ sent, failed: failures.length, total, failures });
}
