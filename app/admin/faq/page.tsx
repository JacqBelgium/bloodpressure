import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminFaqManager } from "@/components/AdminFaqManager";

export default async function AdminFaqPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || user.email !== process.env.ADMIN_EMAIL) {
    redirect("/");
  }

  const admin = createAdminClient();
  const { data: faqs, error } = await admin
    .from("support_faq")
    .select("id, question_nl, answer_nl, question_en, answer_en")
    .order("id");

  if (error) {
    // Passing `error` directly (not a destructured/stringified copy) so
    // Node's console formatter shows the real shape, whatever it is —
    // JSON.stringify(error) silently returns "{}" for Error-like objects
    // because `message` is a non-enumerable own property.
    console.error("[admin/faq] Failed to fetch support_faq:", error);
    console.error(
      "[admin/faq] raw error JSON:",
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    );
  }

  return (
    <main className="flex-1 bg-teal-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold text-slate-800">FAQ-beheer</h1>
        <p className="mt-2 text-base text-slate-600">
          Beheer de vragen en antwoorden die de support-widget gebruikt.
        </p>
        <AdminFaqManager initialFaqs={faqs ?? []} />
      </div>
    </main>
  );
}
