import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Lang = "nl" | "en";

type Exercise = {
  id: string;
  nummer: number;
  titel_nl: string;
  titel_en: string;
  beginpositie_nl: string | null;
  beginpositie_en: string | null;
  beweging_nl: string | null;
  beweging_en: string | null;
  type: string | null;
  duur: string | number | null;
  reeksen: string | number | null;
  intensiteit: string | number | null;
  rust: string | number | null;
  sets_structure: string | null;
  detail_nl: string | null;
  detail_en: string | null;
  foto_url: string | null;
  video_url: string | null;
  audio_url_nl: string | null;
  audio_url_en: string | null;
  bron: string | null;
};

const TOTAL_WEEKS = 20;

const copy: Record<Lang, Record<string, string>> = {
  nl: {
    disclaimer:
      "Deze oefeningen zijn een aanvulling op — niet een vervanging van — voorgeschreven medicatie. Volg altijd de adviezen van je behandelende arts of specialist.",
    week: "Week",
    of: "van",
    welcome: "Hallo",
    startPosition: "Beginpositie",
    movement: "Beweging",
    details: "Details",
    type: "Type",
    duration: "Duur",
    sets: "Reeksen",
    intensity: "Intensiteit",
    rest: "Rust",
    setsStructure: "Opbouw",
    photo: "Foto",
    video: "Video",
    audio: "Audio",
    photoPlaceholder: "Foto volgt binnenkort.",
    videoPlaceholder: "Video volgt binnenkort.",
    audioPlaceholder: "Audio volgt binnenkort.",
    source: "Bron",
    notLoggedInHeading: "Bijna klaar",
    notLoggedInBody:
      "We hebben je een inloglink gestuurd. Open je e-mail en klik op de link om verder te gaan.",
    registerLink: "Nog niet aangemeld? Registreer hier.",
    noExercise: "Er is op dit moment geen oefening beschikbaar.",
  },
  en: {
    disclaimer:
      "These exercises are a complement to — not a replacement for — prescribed medication. Always follow the advice of your treating doctor or specialist.",
    week: "Week",
    of: "of",
    welcome: "Hello",
    startPosition: "Starting position",
    movement: "Movement",
    details: "Details",
    type: "Type",
    duration: "Duration",
    sets: "Sets",
    intensity: "Intensity",
    rest: "Rest",
    setsStructure: "Structure",
    photo: "Photo",
    video: "Video",
    audio: "Audio",
    photoPlaceholder: "Photo coming soon.",
    videoPlaceholder: "Video coming soon.",
    audioPlaceholder: "Audio coming soon.",
    source: "Source",
    notLoggedInHeading: "Almost there",
    notLoggedInBody:
      "We've sent you a login link. Open your email and click the link to continue.",
    registerLink: "Not registered yet? Register here.",
    noExercise: "No exercise is available right now.",
  },
};

function MediaPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-teal-200 bg-teal-50/50 text-center text-base text-slate-500">
      {label}
    </div>
  );
}

export default async function Home() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return (
      <main className="flex flex-1 items-center justify-center bg-teal-50 px-4 py-12">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-teal-100 sm:p-10">
          <h1 className="text-2xl font-semibold text-slate-800">
            Supabase is nog niet ingesteld
          </h1>
          <p className="mt-3 text-lg text-slate-600">
            Vul de Supabase-gegevens in <code>.env.local</code> aan om deze
            pagina te gebruiken.
          </p>
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const t = copy.nl;
    return (
      <main className="flex flex-1 items-center justify-center bg-teal-50 px-4 py-12">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-teal-100 sm:p-10">
          <h1 className="text-2xl font-semibold text-slate-800">
            {t.notLoggedInHeading}
          </h1>
          <p className="mt-3 text-lg text-slate-600">{t.notLoggedInBody}</p>
          <p className="mt-6 text-base text-slate-500">
            <Link href="/register" className="font-medium text-teal-700 underline">
              {t.registerLink}
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const { data: profile } = await supabase
    .from("users")
    .select("voornaam, taal_voorkeur")
    .eq("email", user.email)
    .maybeSingle();

  const lang: Lang = profile?.taal_voorkeur === "en" ? "en" : "nl";
  const t = copy[lang];

  const { data: rpcData } = await supabase.rpc("get_current_exercise");
  const exercise = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | Exercise
    | null
    | undefined;

  return (
    <main className="flex-1 bg-teal-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl bg-amber-50 p-5 text-base leading-relaxed text-amber-900 ring-1 ring-amber-200 sm:text-lg">
          {t.disclaimer}
        </div>

        <div className="mt-8 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold text-slate-800 sm:text-3xl">
            {t.welcome}
            {profile?.voornaam ? `, ${profile.voornaam}` : ""}
          </h1>
        </div>

        {!exercise ? (
          <p className="mt-6 text-lg text-slate-600">{t.noExercise}</p>
        ) : (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-teal-100 sm:p-8">
            <p className="text-lg font-medium text-teal-700">
              {t.week} {exercise.nummer} {t.of} {TOTAL_WEEKS}
            </p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-800">
              {lang === "nl" ? exercise.titel_nl : exercise.titel_en}
            </h2>

            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              {exercise.foto_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={exercise.foto_url}
                  alt={lang === "nl" ? exercise.titel_nl : exercise.titel_en}
                  className="h-40 w-full rounded-xl object-cover"
                />
              ) : (
                <MediaPlaceholder label={t.photoPlaceholder} />
              )}

              {exercise.video_url ? (
                <video
                  controls
                  className="h-40 w-full rounded-xl bg-black object-cover"
                  src={exercise.video_url}
                />
              ) : (
                <MediaPlaceholder label={t.videoPlaceholder} />
              )}

              {(lang === "nl" ? exercise.audio_url_nl : exercise.audio_url_en) ? (
                <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-xl border border-teal-100 bg-teal-50/50 p-4">
                  <span className="text-base text-slate-600">{t.audio}</span>
                  <audio
                    controls
                    className="w-full"
                    src={
                      lang === "nl" ? exercise.audio_url_nl! : exercise.audio_url_en!
                    }
                  />
                </div>
              ) : (
                <MediaPlaceholder label={t.audioPlaceholder} />
              )}
            </div>

            <dl className="mt-8 space-y-5">
              {(lang === "nl" ? exercise.beginpositie_nl : exercise.beginpositie_en) && (
                <div>
                  <dt className="text-base font-semibold text-slate-700">
                    {t.startPosition}
                  </dt>
                  <dd className="mt-1 text-lg text-slate-700">
                    {lang === "nl" ? exercise.beginpositie_nl : exercise.beginpositie_en}
                  </dd>
                </div>
              )}

              {(lang === "nl" ? exercise.beweging_nl : exercise.beweging_en) && (
                <div>
                  <dt className="text-base font-semibold text-slate-700">
                    {t.movement}
                  </dt>
                  <dd className="mt-1 text-lg text-slate-700">
                    {lang === "nl" ? exercise.beweging_nl : exercise.beweging_en}
                  </dd>
                </div>
              )}

              {(lang === "nl" ? exercise.detail_nl : exercise.detail_en) && (
                <div>
                  <dt className="text-base font-semibold text-slate-700">
                    {t.details}
                  </dt>
                  <dd className="mt-1 text-lg text-slate-700">
                    {lang === "nl" ? exercise.detail_nl : exercise.detail_en}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-8 grid grid-cols-2 gap-4 border-t border-slate-100 pt-6 sm:grid-cols-3">
              {exercise.type && (
                <div>
                  <dt className="text-sm font-medium text-slate-500">{t.type}</dt>
                  <dd className="text-lg text-slate-800">{exercise.type}</dd>
                </div>
              )}
              {exercise.duur != null && (
                <div>
                  <dt className="text-sm font-medium text-slate-500">
                    {t.duration}
                  </dt>
                  <dd className="text-lg text-slate-800">{exercise.duur}</dd>
                </div>
              )}
              {exercise.reeksen != null && (
                <div>
                  <dt className="text-sm font-medium text-slate-500">{t.sets}</dt>
                  <dd className="text-lg text-slate-800">{exercise.reeksen}</dd>
                </div>
              )}
              {exercise.intensiteit != null && (
                <div>
                  <dt className="text-sm font-medium text-slate-500">
                    {t.intensity}
                  </dt>
                  <dd className="text-lg text-slate-800">{exercise.intensiteit}</dd>
                </div>
              )}
              {exercise.rust != null && (
                <div>
                  <dt className="text-sm font-medium text-slate-500">{t.rest}</dt>
                  <dd className="text-lg text-slate-800">{exercise.rust}</dd>
                </div>
              )}
              {exercise.sets_structure && (
                <div>
                  <dt className="text-sm font-medium text-slate-500">
                    {t.setsStructure}
                  </dt>
                  <dd className="text-lg text-slate-800">
                    {exercise.sets_structure}
                  </dd>
                </div>
              )}
            </div>

            {exercise.bron && (
              <p className="mt-8 text-sm text-slate-400">
                {t.source}: {exercise.bron}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
