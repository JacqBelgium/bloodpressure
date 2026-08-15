"use server";

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
  const admin = createAdminClient();
  const { error: dbError } = await admin
    .from("users")
    .upsert(
      { email, voornaam, taal_voorkeur: input.taalVoorkeur },
      { onConflict: "email" },
    );

  if (dbError) {
    return { status: "error", message: dbError.message };
  }

  const supabase = await createClient();
  const { error: authError } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (authError) {
    return { status: "error", message: authError.message };
  }

  return { status: "ok" };
}
