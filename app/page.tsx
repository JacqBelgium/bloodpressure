import { headers } from "next/headers";
import { RegisterForm } from "@/components/RegisterForm";
import { createClient } from "@/lib/supabase/server";
import { detectLangFromAcceptHeader, type Lang } from "@/lib/lang";
import { formatWeekRange, getIsoWeekNumber, getIsoWeekRange } from "@/lib/date";

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

const copy: Record<Lang, Record<string, string>> = {
  nl: {
    payoff:
      "Bloeddrukverlaging onderbouwd door onderzoek naar statische, isometrische oefeningen.",
    intro:
      "Heeft u een verhoogde bloeddruk en zoekt u een veilige, effectieve manier om deze te verlagen of te stabiliseren? Zonder zware cardiotraining of ingewikkelde schema's? Ontdek de stille kracht van StaticIso. Recent medisch onderzoek toont aan dat het statisch aanspannen van uw spieren – zoals bij een eenvoudige muurzit of handknijpoefening – uw bloedvaten helpt te ontspannen en te verwijden. Met slechts enkele minuten per dag traint u uw bloeddruk effectief omlaag. De meest efficiënte methode voor uw cardiovasculaire gezondheid. Gewoon vanuit huis.",
    disclaimer:
      "Deze oefeningen zijn een aanvulling op — niet een vervanging van — voorgeschreven medicatie. Volg altijd de adviezen van je behandelende arts of specialist.",
    week: "Week",
    exerciseIntro: "Uw oefening voor week",
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
    noExercise: "Er is op dit moment geen oefening beschikbaar.",
    exerciseLoadError:
      "Er ging iets mis bij het laden van de oefening, probeer het later opnieuw.",
    medicalDisclaimer:
      "Ervaart u problemen of pijn tijdens het uitvoeren van een oefening? Raadpleeg dan uw arts. Wij zijn niet aansprakelijk voor enige schade voortvloeiend uit het gebruik van deze oefeningen.",
  },
  en: {
    payoff:
      "Blood pressure reduction supported by research on static, isometric exercise.",
    intro:
      "Do you have high blood pressure and are you looking for a safe, effective way to lower or stabilize it? Without intense cardio training or complicated schedules? Discover the quiet power of StaticIso. Recent medical research shows that statically contracting your muscles — such as during a simple wall sit or handgrip exercise — helps relax and widen your blood vessels. In just a few minutes a day, you can effectively train your blood pressure down. The most efficient method for your cardiovascular health. Right from home.",
    disclaimer:
      "These exercises are a complement to — not a replacement for — prescribed medication. Always follow the advice of your treating doctor or specialist.",
    week: "Week",
    exerciseIntro: "Your exercise for week",
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
    noExercise: "No exercise is available right now.",
    exerciseLoadError:
      "Something went wrong loading the exercise, please try again later.",
    medicalDisclaimer:
      "If you experience problems or pain while performing an exercise, please consult your doctor. We are not liable for any damages resulting from the use of these exercises.",
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
    const headersList = await headers();
    const lang = detectLangFromAcceptHeader(headersList.get("accept-language"));
    const t = copy[lang];
    return (
      <main className="flex-1 bg-teal-50 px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <p className="text-xl font-semibold text-teal-800 sm:text-2xl">
            {t.payoff}
          </p>
          <p className="mt-3 text-base leading-relaxed text-slate-600 sm:text-lg">
            {t.intro}
          </p>
          <div className="mt-8 flex justify-center">
            <RegisterForm />
          </div>
        </div>
      </main>
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("voornaam, taal_voorkeur")
    .eq("email", user.email)
    .maybeSingle();

  if (profileError) {
    console.error("[home] Supabase profile lookup on 'users' failed:", {
      message: profileError.message,
      details: profileError.details,
      hint: profileError.hint,
      code: profileError.code,
    });
  }

  const lang: Lang = profile?.taal_voorkeur === "en" ? "en" : "nl";
  const t = copy[lang];

  let exercise: Exercise | null | undefined;
  let exerciseLoadError = false;

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "get_current_exercise",
    );

    if (rpcError) {
      console.error("[home] get_current_exercise RPC failed:", rpcError.message);
      exerciseLoadError = true;
    } else {
      exercise = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
        | Exercise
        | null
        | undefined;
    }
  } catch (err) {
    console.error("[home] get_current_exercise threw unexpectedly:", err);
    exerciseLoadError = true;
  }

  const now = new Date();
  const isoWeekNumber = getIsoWeekNumber(now);
  const { start: weekStart, end: weekEnd } = getIsoWeekRange(now);
  const weekRangeLabel = formatWeekRange(weekStart, weekEnd, lang);

  return (
    <main className="flex-1 bg-teal-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl bg-amber-50 p-5 text-base leading-relaxed text-amber-900 ring-1 ring-amber-200 sm:text-lg">
          {t.disclaimer}
        </div>

        <div className="mt-8">
          <h1 className="text-2xl font-semibold text-slate-800 sm:text-3xl">
            {t.welcome}
            {profile?.voornaam ? ` ${profile.voornaam}` : ""}
          </h1>
        </div>

        {exerciseLoadError ? (
          <p className="mt-6 text-lg text-red-600">{t.exerciseLoadError}</p>
        ) : !exercise ? (
          <p className="mt-6 text-lg text-slate-600">{t.noExercise}</p>
        ) : (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-teal-100 sm:p-8">
            <p className="text-base text-slate-600">
              {t.exerciseIntro} {isoWeekNumber}, {weekRangeLabel}
            </p>
            <div className="mt-3 rounded-2xl bg-amber-50 p-5 text-lg font-medium text-amber-900 ring-1 ring-amber-200">
              {t.week} {isoWeekNumber}: {weekRangeLabel}
            </div>
            <h2 className="mt-6 text-3xl font-semibold text-slate-800">
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

        <p className="mt-8 text-sm leading-relaxed text-slate-500">
          {t.medicalDisclaimer}
        </p>
      </div>
    </main>
  );
}
