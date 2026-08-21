"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type UpdateAccountInput = {
  voornaam: string;
  taalVoorkeur: "nl" | "en";
};

export type UpdateAccountResult = { status: "ok" } | { status: "error"; message: string };

export async function updateAccount(input: UpdateAccountInput): Promise<UpdateAccountResult> {
  const voornaam = input.voornaam.trim();

  if (!voornaam) {
    return { status: "error", message: "missing_voornaam" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { status: "error", message: "not_authenticated" };
  }

  // Uses the secret key for the same reason registration does: the
  // users-table write policies aren't set up for a plain authenticated
  // update, so the user's own row is looked up server-side via their
  // verified session email and updated with the admin client.
  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ voornaam, taal_voorkeur: input.taalVoorkeur })
    .eq("email", user.email);

  if (error) {
    console.error("[updateAccount] Supabase update on 'users' failed:", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return { status: "error", message: error.message };
  }

  // The header (root layout) and home page both read voornaam/taal_voorkeur
  // server-side; without this, a plain <Link> navigation could reuse the
  // router's cached, now-stale layout instead of refetching it.
  revalidatePath("/", "layout");

  return { status: "ok" };
}
