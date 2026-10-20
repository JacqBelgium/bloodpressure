import { RegisterForm } from "@/components/RegisterForm";
import { parseLang } from "@/lib/lang";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] | undefined }>;
}) {
  const { lang } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center bg-teal-50 px-4 py-12">
      <RegisterForm initialLang={parseLang(lang)} />
    </main>
  );
}
