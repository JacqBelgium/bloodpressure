"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type RegisterInput = {
  voornaam: string;
  email: string;
  taalVoorkeur: "nl" | "en";
};

export type RegisterResult = { status: "ok" } | { status: "error"; message: string };

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const voornaam = input.voornaam.trim();
  const email = input.email.trim().toLowerCase();

  if (!voornaam || !email) {
    return { status: "error", message: "missing_fields" };
  }

  // Uses the secret key so the row can be written before the user has
  // clicked their magic link (i.e. before any session/RLS identity exists).
  if (!process.env.SUPABASE_SECRET_KEY) {
    console.error("[register] SUPABASE_SECRET_KEY is not set in this environment");
  }

  const admin = createAdminClient();
  const { data: dbData, error: dbError } = await admin
    .from("users")
    .upsert(
      { email, voornaam, taal_voorkeur: input.taalVoorkeur },
      { onConflict: "email" },
    )
    .select();

  if (dbError) {
    console.error("[register] Supabase upsert into 'users' failed:", {
      message: dbError.message,
      details: dbError.details,
      hint: dbError.hint,
      code: dbError.code,
    });
    return { status: "error", message: dbError.message };
  }

  console.error("[register] Supabase upsert succeeded, row(s):", dbData);

  // Origin header covers both localhost and production automatically;
  // x-forwarded-proto/host is the fallback for requests where it's absent.
  const headersList = await headers();
  const origin =
    headersList.get("origin") ??
    `${headersList.get("x-forwarded-proto") ?? "http"}://${headersList.get("host")}`;

  const supabase = await createClient();
  const { error: authError } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (authError) {
    console.error("[register] Supabase signInWithOtp failed:", {
      message: authError.message,
      status: authError.status,
      name: authError.name,
    });
    return { status: "error", message: authError.message };
  }

  return { status: "ok" };
}
