import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  const to = request.nextUrl.searchParams.get("to");
  const name = request.nextUrl.searchParams.get("name") ?? "there";

  if (!to) {
    return NextResponse.json(
      {
        error:
          "Missing 'to' query parameter, e.g. /api/test-email?to=you@example.com&name=You",
      },
      { status: 400 },
    );
  }

  try {
    await sendEmail({
      to: { email: to, name },
      subject: "StaticIso test email",
      htmlBody: "<div><b>Test email sent successfully.</b></div>",
    });
    return NextResponse.json({ status: "sent", to });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
