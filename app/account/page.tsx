import { redirect } from "next/navigation";
import { AccountForm } from "@/components/AccountForm";
import { createClient } from "@/lib/supabase/server";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("voornaam, taal_voorkeur")
    .eq("email", user.email)
    .maybeSingle();

  if (profileError) {
    console.error("[account] Supabase profile lookup on 'users' failed:", {
      message: profileError.message,
      details: profileError.details,
      hint: profileError.hint,
      code: profileError.code,
    });
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-teal-50 px-4 py-12">
      <AccountForm
        email={user.email ?? ""}
        voornaam={profile?.voornaam ?? ""}
        taalVoorkeur={profile?.taal_voorkeur === "en" ? "en" : "nl"}
      />
    </main>
  );
}
