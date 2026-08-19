"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type LoginResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "error"; message: string };

export async function loginUser(input: { email: string }): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();

  if (!email) {
    return { status: "error", message: "missing_email" };
  }

  // Uses the secret key because the users-table select policy only
  // allows a logged-in owner to read their own row — an anonymous
  // visitor can't otherwise check whether this email is registered.
  const admin = createAdminClient();
  const { data: existing, error: lookupError } = await admin
    .from("users")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (lookupError) {
    console.error("[login] Supabase lookup on 'users' failed:", {
      message: lookupError.message,
      details: lookupError.details,
      hint: lookupError.hint,
      code: lookupError.code,
    });
    return { status: "error", message: lookupError.message };
  }

  if (!existing) {
    return { status: "not_found" };
  }

  const headersList = await headers();
  const origin =
    headersList.get("origin") ??
    `${headersList.get("x-forwarded-proto") ?? "http"}://${headersList.get("host")}`;

  const supabase = await createClient();
  const { error: authError } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (authError) {
    console.error("[login] Supabase signInWithOtp failed:", {
      message: authError.message,
      status: authError.status,
      name: authError.name,
    });
    return { status: "error", message: authError.message };
  }

  return { status: "ok" };
}
