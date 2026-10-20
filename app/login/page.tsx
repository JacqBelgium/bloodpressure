import { LoginForm } from "@/components/LoginForm";
import { parseLang } from "@/lib/lang";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    lang?: string | string[] | undefined;
    error?: string | string[] | undefined;
  }>;
}) {
  const { lang, error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center bg-teal-50 px-4 py-12">
      <LoginForm initialLang={parseLang(lang)} linkExpired={error === "link_expired"} />
    </main>
  );
}
