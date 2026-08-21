"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type FaqInput = {
  question_nl: string;
  answer_nl: string;
  question_en: string;
  answer_en: string;
};

export type FaqRow = FaqInput & { id: string };

export type FaqActionResult = { status: "ok" } | { status: "error"; message: string };
export type AddFaqResult = { status: "ok"; faq: FaqRow } | { status: "error"; message: string };

async function assertAdmin(): Promise<FaqActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || user.email !== process.env.ADMIN_EMAIL) {
    return { status: "error", message: "not_authorized" };
  }
  return { status: "ok" };
}

export async function addFaq(input: FaqInput): Promise<AddFaqResult> {
  const auth = await assertAdmin();
  if (auth.status === "error") return auth;

  const admin = createAdminClient();
  const { data, error } = await admin.from("support_faq").insert(input).select().single();

  if (error) {
    console.error("[admin/faq] insert failed:", error);
    console.error("[admin/faq] raw error JSON:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/faq");
  return { status: "ok", faq: data as FaqRow };
}

export async function updateFaq(id: string, input: FaqInput): Promise<FaqActionResult> {
  const auth = await assertAdmin();
  if (auth.status === "error") return auth;

  const admin = createAdminClient();
  const { error } = await admin.from("support_faq").update(input).eq("id", id);

  if (error) {
    console.error("[admin/faq] update failed:", error);
    console.error("[admin/faq] raw error JSON:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/faq");
  return { status: "ok" };
}

export async function deleteFaq(id: string): Promise<FaqActionResult> {
  const auth = await assertAdmin();
  if (auth.status === "error") return auth;

  const admin = createAdminClient();
  const { error } = await admin.from("support_faq").delete().eq("id", id);

  if (error) {
    console.error("[admin/faq] delete failed:", error);
    console.error("[admin/faq] raw error JSON:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/faq");
  return { status: "ok" };
}
