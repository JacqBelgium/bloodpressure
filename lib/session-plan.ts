import type { Lang } from "./lang";

export type SessionVoice = "vrouw" | "man";
export type ChosenHoldSeconds = 60 | 90 | 120;

export interface SessionExercise {
  nummer: number;
  sets: number;
  per_kant: boolean;
  hold_seconden: number | null;
  rondes: number;
  rust_seconden: number;
  halverwege_variant: string | null;
}

export interface SharedAudioFragment {
  key: string;
  lang: Lang;
  voice?: SessionVoice;
  variant: number;
  text: string;
  url: string | null;
}

export interface IntroAudioFragment {
  exercise_nummer: number;
  lang: Lang;
  voice?: SessionVoice;
  text: string;
  url: string | null;
}

export type SessionAudioFragment = SharedAudioFragment | IntroAudioFragment;

export interface AudioStep {
  type: "audio";
  fragment: SessionAudioFragment;
  text: string;
  setNumber?: number;
  sideNumber?: number;
}

export interface WaitStep {
  type: "wait";
  seconds: number;
  label: string;
  setNumber?: number;
}

export interface TimerMidpoint {
  atSeconds: number;
  audio: AudioStep;
}

export interface TimerStep {
  type: "timer";
  seconds: number;
  label: string;
  setNumber?: number;
  sideNumber?: number;
  midpoint?: TimerMidpoint;
}

export type SessionStep = AudioStep | WaitStep | TimerStep;

export interface SessionPlanOptions {
  lang: Lang;
  voice: SessionVoice;
  chosenHoldSeconds: ChosenHoldSeconds;
  /** A seed makes the randomized fragment choices repeatable while keeping planning pure. */
  randomSeed: number;
}

export interface SessionPlanResult {
  steps: SessionStep[];
  warning?: string;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickVariant(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function findSharedFragment(
  fragments: readonly SessionAudioFragment[],
  key: string,
  variant: number,
  options: SessionPlanOptions,
): SharedAudioFragment | undefined {
  return fragments.find((fragment): fragment is SharedAudioFragment =>
    "key" in fragment
    && fragment.key === key
    && fragment.lang === options.lang
    && fragment.variant === variant
    && (!fragment.voice || fragment.voice === options.voice),
  );
}

function findIntroFragment(
  fragments: readonly SessionAudioFragment[],
  exerciseNumber: number,
  options: SessionPlanOptions,
): IntroAudioFragment | undefined {
  return fragments.find((fragment): fragment is IntroAudioFragment =>
    "exercise_nummer" in fragment
    && fragment.exercise_nummer === exerciseNumber
    && fragment.lang === options.lang
    && (!fragment.voice || fragment.voice === options.voice),
  );
}

function addAudioStep(
  steps: SessionStep[],
  fragment: SessionAudioFragment | undefined,
  setNumber?: number,
  sideNumber?: number,
): void {
  if (fragment) {
    // Keep the text step even when URL is null so the caller can still show subtitles.
    steps.push({ type: "audio", fragment, text: fragment.text, setNumber, sideNumber });
  }
}

function getHalfwayKey(variant: string | null): string {
  const normalizedVariant = variant?.trim() || "default";
  return `halverwege_${normalizedVariant}`;
}

function getLabels(lang: Lang) {
  if (lang === "en") {
    return {
      preparation: "Get into the starting position",
      hold: () => "Hold",
      side: () => "Switch sides",
      rest: () => "Rest",
    };
  }

  return {
    preparation: "Neem de beginpositie aan",
    hold: () => "Houd vast",
    side: () => "Wissel van kant",
    rest: () => "Rust",
  };
}

/**
 * Builds a deterministic session plan from an exercise and its available audio rows.
 * A missing audio URL never removes the step or its text; the player can render the text
 * as a subtitle and simply omit playback. Exercise 8 is intentionally not supported yet.
 */
export function buildSessionPlan(
  exercise: SessionExercise,
  fragments: readonly SessionAudioFragment[],
  options: SessionPlanOptions,
): SessionPlanResult {
  if (exercise.nummer === 8) {
    return {
      steps: [],
      warning: options.lang === "en"
        ? "Exercise 8 (Split Squat) is not supported in the session planner yet. No steps were planned."
        : "Oefening 8 (Split Squat) wordt nog niet ondersteund door de sessieplanner. Er zijn geen stappen gepland.",
    };
  }

  if (!Number.isInteger(exercise.sets) || exercise.sets < 1) {
    throw new Error("Exercise sets must be a positive integer.");
  }
  if (!Number.isInteger(exercise.rondes) || exercise.rondes < 1) {
    throw new Error("Exercise rondes must be a positive integer.");
  }
  if (!Number.isFinite(exercise.rust_seconden) || exercise.rust_seconden < 0) {
    throw new Error("Exercise rust_seconden must be a non-negative number.");
  }
  if (exercise.hold_seconden !== null && (!Number.isFinite(exercise.hold_seconden) || exercise.hold_seconden <= 0)) {
    throw new Error("Exercise hold_seconden must be null or a positive number.");
  }
  if (!Number.isFinite(options.randomSeed) || !Number.isInteger(options.randomSeed)) {
    throw new Error("A finite integer randomSeed is required to choose audio variants deterministically.");
  }

  const holdSeconds = exercise.hold_seconden ?? options.chosenHoldSeconds;
  const random = createSeededRandom(options.randomSeed);
  const labels = getLabels(options.lang);
  const steps: SessionStep[] = [];
  const openingVariant = pickVariant(random, 1, 3);

  addAudioStep(steps, findSharedFragment(fragments, "openingszin", openingVariant, options));
  addAudioStep(steps, findIntroFragment(fragments, exercise.nummer, options));
  addAudioStep(steps, findSharedFragment(fragments, "veiligheid", 0, options));

  const halfwayFragment = holdSeconds >= 30
    ? findSharedFragment(fragments, getHalfwayKey(exercise.halverwege_variant), 0, options)
    : undefined;
  const startFragmentKey = exercise.halverwege_variant === "langzaam"
    ? "start_langzaam"
    : "start_eindpositie";

  for (let setNumber = 1; setNumber <= exercise.sets; setNumber += 1) {
    addAudioStep(steps, findSharedFragment(fragments, "set_aankondiging", setNumber, options), setNumber);
    steps.push({ type: "wait", seconds: 10, label: labels.preparation, setNumber });

    for (let roundNumber = 1; roundNumber <= exercise.rondes; roundNumber += 1) {
      const sides = exercise.per_kant ? [1, 2] : [1];

      for (const sideNumber of sides) {
        addAudioStep(steps, findSharedFragment(fragments, startFragmentKey, 0, options), setNumber, sideNumber);
        const timer: TimerStep = {
          type: "timer",
          seconds: holdSeconds,
          label: labels.hold(),
          setNumber,
          sideNumber,
        };

        if (halfwayFragment) {
          timer.midpoint = {
            atSeconds: holdSeconds / 2,
            audio: { type: "audio", fragment: halfwayFragment, text: halfwayFragment.text, setNumber, sideNumber },
          };
        }
        steps.push(timer);

        if (exercise.per_kant && sideNumber === 1) {
          addAudioStep(steps, findSharedFragment(fragments, "wissel_kant", 0, options), setNumber, sideNumber);
          steps.push({ type: "wait", seconds: 10, label: labels.side(), setNumber });
        }
      }
    }

    if (setNumber < exercise.sets) {
      addAudioStep(steps, findSharedFragment(fragments, "rust", 0, options), setNumber);
      steps.push({ type: "timer", seconds: exercise.rust_seconden, label: labels.rest(), setNumber });
      const motivationVariant = pickVariant(random, 1, 4);
      addAudioStep(steps, findSharedFragment(fragments, "motivatie", motivationVariant, options), setNumber);
    }
  }

  const closingVariant = pickVariant(random, 1, 4);
  addAudioStep(steps, findSharedFragment(fragments, "afsluiting", closingVariant, options));

  return { steps };
}
