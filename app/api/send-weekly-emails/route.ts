import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { formatWeekRange, getIsoWeekInZone, getIsoWeekRange } from "@/lib/date";
import { escapeHtml } from "@/lib/html";
import { parseLang, type Lang } from "@/lib/lang";

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

function buildHtmlBody({
  voornaam,
  title,
  isoWeekNumber,
  weekRangeLabel,
  lang,
  ctaLink,
}: {
  voornaam: string;
  title: string;
  isoWeekNumber: number;
  weekRangeLabel: string;
  lang: Lang;
  ctaLink: string;
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
          href="${ctaLink}"
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

  // Test options: ?only=<email> sends to that one existing user only and
  // bypasses weekly_send_log (nothing is checked or written there), and
  // ?lang=en|nl (only together with ?only) forces the language of that email.
  // ?dryrun=1 only reports who would be emailed or skipped: no email is sent
  // and nothing is written to the log.
  const onlyParam = request.nextUrl.searchParams.get("only");
  const only = onlyParam?.trim().toLowerCase() || null;
  const langParam = request.nextUrl.searchParams.get("lang");
  const forcedLang = only ? parseLang(langParam) : null;
  const dryRun = request.nextUrl.searchParams.get("dryrun") === "1";

  if (onlyParam !== null && !only) {
    return NextResponse.json({ error: "Parameter 'only' is empty" }, { status: 400 });
  }
  if (only && langParam !== null && !forcedLang) {
    return NextResponse.json({ error: `Invalid lang '${langParam}', use 'en' or 'nl'` }, { status: 400 });
  }

  const admin = createAdminClient();

  let usersQuery = admin.from("users").select("email, voornaam, taal_voorkeur");
  if (only) usersQuery = usersQuery.eq("email", only);
  const { data: users, error: usersError } = await usersQuery;

  if (usersError) {
    console.error("[send-weekly-emails] Failed to fetch users:", {
      message: usersError.message,
      details: usersError.details,
      hint: usersError.hint,
      code: usersError.code,
    });
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }

  if (only && (users ?? []).length === 0) {
    return NextResponse.json({ error: `No registered user with email '${only}'` }, { status: 404 });
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

  // The week is determined in Europe/Brussels, for both the log and the email.
  const { isoYear, isoWeek, calendarDate } = getIsoWeekInZone(new Date());
  const isoWeekNumber = isoWeek;
  const { start, end } = getIsoWeekRange(calendarDate);
  const allUsers = users ?? [];

  // Users already in the log for this week are skipped (not with ?only).
  const alreadyLogged = new Set<string>();
  if (!only) {
    const { data: logRows, error: logError } = await admin
      .from("weekly_send_log")
      .select("user_email")
      .eq("iso_year", isoYear)
      .eq("iso_week", isoWeek);

    if (logError) {
      console.error("[send-weekly-emails] Failed to read weekly_send_log:", {
        message: logError.message,
        details: logError.details,
        hint: logError.hint,
        code: logError.code,
      });
      return NextResponse.json({ error: logError.message }, { status: 500 });
    }
    for (const row of logRows ?? []) alreadyLogged.add(row.user_email);
  }

  const toSend = allUsers.filter((u) => !alreadyLogged.has(u.email));
  const skippedEmails = allUsers.filter((u) => alreadyLogged.has(u.email)).map((u) => u.email);

  if (dryRun) {
    return NextResponse.json({
      dryrun: true,
      iso_year: isoYear,
      iso_week: isoWeek,
      log_bypassed: Boolean(only),
      would_send: toSend.length,
      skipped: skippedEmails.length,
      total: allUsers.length,
      recipients: toSend.map((u) => u.email),
      skipped_recipients: skippedEmails,
    });
  }

  // Removes a reservation after a failed send, so the next run retries it.
  async function releaseReservation(email: string): Promise<string | null> {
    if (only) return null;
    const { error } = await admin
      .from("weekly_send_log")
      .delete()
      .eq("iso_year", isoYear)
      .eq("iso_week", isoWeek)
      .eq("user_email", email);
    if (error) {
      console.error(`[send-weekly-emails] Failed to release log entry for ${email}:`, error.message, error);
      return `; log entry could not be removed (${error.message}), next run will skip this user`;
    }
    return null;
  }

  let sent = 0;
  const failures: { email: string; reason: string }[] = [];

  for (const user of toSend) {
    // Reserve the log entry before sending. The unique constraint on
    // (iso_year, iso_week, user_email) makes a concurrent run fail here.
    if (!only) {
      const { error: reserveError } = await admin
        .from("weekly_send_log")
        .insert({ user_email: user.email, iso_year: isoYear, iso_week: isoWeek });

      if (reserveError) {
        if (reserveError.code === "23505") {
          skippedEmails.push(user.email);
          continue;
        }
        console.error(`[send-weekly-emails] Failed to reserve log entry for ${user.email}:`, reserveError.message, reserveError);
        failures.push({ email: user.email, reason: `Log reservation failed: ${reserveError.message}` });
        continue;
      }
    }

    const lang: Lang = forcedLang ?? (user.taal_voorkeur === "en" ? "en" : "nl");
    const weekRangeLabel = formatWeekRange(start, end, lang);
    const title = lang === "nl" ? exercise.titel_nl : exercise.titel_en;

    // A plain link to the site would land the user on the login/register
    // screen if the email client opens it without the browser's existing
    // session cookies (common with Gmail etc.). A single-use token per
    // recipient signs the user in via /auth/confirm, regardless of session
    // state. The language travels along so a failed sign-in still lands on
    // a login page in the recipient's language.
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      const reason = linkError?.message ?? "Failed to generate magic link";
      console.error(`[send-weekly-emails] Failed to generate link for ${user.email}:`, reason, linkError);
      failures.push({ email: user.email, reason: reason + ((await releaseReservation(user.email)) ?? "") });
      continue;
    }

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
          ctaLink: `${SITE_URL}/auth/confirm?${new URLSearchParams({
            token_hash: linkData.properties.hashed_token,
            type: "magiclink",
            lang,
          })}`,
        }),
      });
      sent += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[send-weekly-emails] Failed to send to ${user.email}:`, reason, err);
      failures.push({ email: user.email, reason: reason + ((await releaseReservation(user.email)) ?? "") });
    }
  }

  const total = allUsers.length;
  const skipped = skippedEmails.length;
  console.error(
    `[send-weekly-emails] Done (${isoYear}-W${isoWeek}): ${sent} sent, ${skipped} skipped, ${failures.length} failed, ${total} total`,
  );

  return NextResponse.json({
    iso_year: isoYear,
    iso_week: isoWeek,
    log_bypassed: Boolean(only),
    sent,
    skipped,
    failed: failures.length,
    total,
    failures,
  });
}
