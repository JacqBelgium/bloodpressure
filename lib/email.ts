import { SendMailClient } from "zeptomail";

export type SendEmailInput = {
  to: { email: string; name: string };
  subject: string;
  htmlBody: string;
};

// The zeptomail SDK doesn't consistently reject with an Error instance:
// validation failures reject with a plain string, and API-level failures
// (e.g. an unverified sender domain) reject with the raw parsed JSON error
// body from ZeptoMail. This normalizes all of those shapes into a readable
// string so callers never end up with an unhelpful "Unknown error".
async function describeSendMailError(err: unknown): Promise<string> {
  if (err instanceof Response) {
    let body = "";
    try {
      body = await err.text();
    } catch {
      // leave body empty if it can't be read
    }
    return `HTTP ${err.status} ${err.statusText}${body ? `: ${body}` : ""}`;
  }

  if (typeof err === "string") {
    return err;
  }

  if (err instanceof Error) {
    const data = (err as { data?: unknown }).data;
    return data ? `${err.message}: ${JSON.stringify(data)}` : err.message;
  }

  if (err && typeof err === "object") {
    try {
      return JSON.stringify(err);
    } catch {
      // fall through to String(err) below
    }
  }

  return String(err);
}

export async function sendEmail({ to, subject, htmlBody }: SendEmailInput) {
  const client = new SendMailClient({
    url: "https://api.zeptomail.com/v1.1/email",
    token: process.env.ZEPTOMAIL_API_KEY!,
  });

  try {
    return await client.sendMail({
      from: {
        address: process.env.ZEPTOMAIL_FROM_EMAIL!,
        name: "StaticIso",
      },
      to: [
        {
          email_address: {
            address: to.email,
            name: to.name,
          },
        },
      ],
      subject,
      htmlbody: htmlBody,
    });
  } catch (err) {
    const reason = await describeSendMailError(err);
    console.error("[sendEmail] ZeptoMail send failed:", {
      to: to.email,
      subject,
      reason,
      raw: err,
    });
    throw new Error(reason);
  }
}
