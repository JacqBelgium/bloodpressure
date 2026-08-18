import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  console.error("[auth/callback] hit:", {
    url: request.url,
    hasCode: Boolean(code),
    cookieNames: request.cookies.getAll().map((c) => c.name),
  });

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      console.error("[auth/callback] exchangeCodeForSession succeeded, user:", data.user?.email);
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error("[auth/callback] exchangeCodeForSession failed:", {
      message: error.message,
      status: error.status,
      name: error.name,
    });
  }

  return NextResponse.redirect(`${origin}/register?error=auth_callback_failed`);
}
