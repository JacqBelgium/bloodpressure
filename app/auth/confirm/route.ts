import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseLang } from "@/lib/lang";

// Landing route for the weekly email. The email carries the hashed token
// from admin.generateLink() instead of Supabase's own action_link: that
// link returns the session in the URL fragment (implicit flow), which
// neither /auth/callback (expects ?code=) nor the PKCE browser client
// can use. Verifying the token here sets the session cookies server-side.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const lang = parseLang(searchParams.get("lang"));

  if (tokenHash && type === "magiclink") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }

    console.error("[auth/confirm] verifyOtp failed:", {
      message: error.message,
      status: error.status,
      name: error.name,
    });
  }

  const loginParams = new URLSearchParams({ error: "link_expired" });
  if (lang) loginParams.set("lang", lang);
  return NextResponse.redirect(`${origin}/login?${loginParams}`);
}
