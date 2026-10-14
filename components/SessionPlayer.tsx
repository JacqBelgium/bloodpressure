"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSessionPlan,
  type ChosenHoldSeconds,
  type SessionAudioFragment,
  type SessionExercise,
  type SessionStep,
  type SessionVoice,
} from "@/lib/session-plan";
import type { Lang } from "@/lib/lang";

type Props = {
  exercise: SessionExercise & { titel: string };
  fragments: SessionAudioFragment[];
  lang: Lang;
  voice: SessionVoice;
  testMode: boolean;
};

type PlaybackState = "ready" | "running" | "paused" | "completed";
type TimedProgress = {
  index: number;
  startedAt: number | null;
  elapsedBeforePause: number;
  durationMs: number;
  midpointPlayed: boolean;
};
type MidpointPhase = "playing" | "after";
type ScreenWakeLock = { release: () => Promise<void> };
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<ScreenWakeLock> };
};

const holdChoices: ChosenHoldSeconds[] = [60, 90, 120];
const HOLD_STORAGE_KEY = "staticiso-session-hold-seconds";
const preloadedUrls = new Set<string>();

const text: Record<Lang, {
  heading: string;
  chooseDuration: string;
  duration: (seconds: number) => string;
  estimate: (minutes: number) => string;
  setHelp: (restSeconds: number) => string;
  keepGoing: string;
  start: string;
  set: (current: number, total: number) => string;
  pause: string;
  resume: string;
  stop: string;
  restart: string;
  completed: string;
  unsupported: string;
  playbackError: string;
  testMode: string;
}> = {
  nl: {
    heading: "Audio begeleiding oefening",
    chooseDuration: "Kies duur uitvoering",
    duration: (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    estimate: (minutes) => `Ongeveer ${minutes} ${minutes === 1 ? "minuut" : "minuten"}`,
    setHelp: (restSeconds) => `Per set krijg je 10 seconden om de beginpositie aan te nemen. Daarna start je de uitvoering. Tussen de sets rust je ${restSeconds} seconden.`,
    keepGoing: "Ga zo door en hou vol",
    start: "Start oefening",
    set: (current, total) => `Set ${current} van ${total}`,
    pause: "Pauze",
    resume: "Verder",
    stop: "Stop",
    restart: "Opnieuw starten",
    completed: "Oefening afgerond. Goed gedaan!",
    unsupported: "Deze oefening wordt nog niet ondersteund door de sessieplanner.",
    playbackError: "Een audiofragment kon niet worden afgespeeld. De sessie gaat verder met de tekst.",
    testMode: "Testmodus: verkorte tijden",
  },
  en: {
    heading: "Audio guidance for this exercise",
    chooseDuration: "Choose duration of execution",
    duration: (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    estimate: (minutes) => `About ${minutes} ${minutes === 1 ? "minute" : "minutes"}`,
    setHelp: (restSeconds) => `You get 10 seconds per set to get into the starting position. Then you start the execution. Between sets you rest ${restSeconds} seconds.`,
    keepGoing: "Keep going, stay strong",
    start: "Start exercise",
    set: (current, total) => `Set ${current} of ${total}`,
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    restart: "Start again",
    completed: "Exercise complete. Well done!",
    unsupported: "This exercise is not supported by the session planner yet.",
    playbackError: "An audio fragment could not be played. The session will continue with text.",
    testMode: "Test mode: shortened times",
  },
};

function applyTestDurations(steps: SessionStep[], lang: Lang): SessionStep[] {
  const restLabel = lang === "nl" ? "Rust" : "Rest";

  return steps.map((step) => {
    if (step.type === "wait") {
      return { ...step, seconds: 2 };
    }
    if (step.type === "timer") {
      const seconds = step.label === restLabel ? 4 : 6;
      return {
        ...step,
        seconds,
        midpoint: step.midpoint ? { ...step.midpoint, atSeconds: seconds / 2 } : undefined,
      };
    }
    return step;
  });
}

function getPlanDurationSeconds(steps: SessionStep[]): number {
  return steps.reduce((total, step) => {
    if (step.type === "timer" || step.type === "wait") return total + step.seconds;
    return total + estimateSpeechSeconds(step.text);
  }, 0);
}

function estimateSpeechSeconds(value: string): number {
  // Rough speech-duration estimate: approximately 140–150 words per minute, around 14 characters per second.
  return Math.max(1, value.trim().length / 14);
}

function getStepAudioUrl(step: SessionStep | undefined): string | null {
  if (!step) return null;
  if (step.type === "audio") return step.fragment.url;
  if (step.type === "timer") return step.midpoint?.audio.fragment.url ?? null;
  return null;
}

export function SessionPlayer({ exercise, fragments, lang, voice, testMode }: Props) {
  const t = text[lang];
  const audioRef = useRef<HTMLAudioElement>(null);
  const wakeLockRef = useRef<ScreenWakeLock | null>(null);
  const timedProgressRef = useRef<TimedProgress | null>(null);
  const activeAudioIndexRef = useRef<number | null>(null);
  const activeStepIndexRef = useRef(0);
  const activeSessionIdRef = useRef(0);
  const sessionLockRef = useRef(false);
  const completedStepsRef = useRef(new Set<number>());
  const stepsRef = useRef<SessionStep[]>([]);
  const [selectedHold, setSelectedHold] = useState<ChosenHoldSeconds>(60);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("ready");
  const [steps, setSteps] = useState<SessionStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [midpoint, setMidpoint] = useState<{ index: number; phase: MidpointPhase } | null>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const isDurationUserSelected = exercise.hold_seconden === null;

  useEffect(() => {
    if (!isDurationUserSelected) return;
    const timeout = window.setTimeout(() => {
      try {
        const stored = Number(window.localStorage.getItem(HOLD_STORAGE_KEY));
        if (holdChoices.includes(stored as ChosenHoldSeconds)) {
          setSelectedHold(stored as ChosenHoldSeconds);
        }
      } catch {
        // localStorage can be blocked; the default remains one minute.
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [isDurationUserSelected]);

  const previewSteps = useMemo(() => {
    const plan = buildSessionPlan(exercise, fragments, {
      lang,
      voice,
      chosenHoldSeconds: isDurationUserSelected ? selectedHold : exercise.hold_seconden as ChosenHoldSeconds,
      randomSeed: 1,
    });
    return testMode ? applyTestDurations(plan.steps, lang) : plan.steps;
  }, [exercise, fragments, isDurationUserSelected, lang, selectedHold, testMode, voice]);

  const estimatedMinutes = Math.max(1, Math.round(getPlanDurationSeconds(previewSteps) / 60));
  const currentStep = steps[stepIndex];
  const restSeconds = Number.isFinite(exercise.rust_seconden) ? exercise.rust_seconden : 60;

  const advanceFrom = useCallback((finishedIndex: number, sessionId: number) => {
    if (sessionId !== activeSessionIdRef.current
      || finishedIndex !== activeStepIndexRef.current
      || completedStepsRef.current.has(finishedIndex)) return;
    completedStepsRef.current.add(finishedIndex);
    activeAudioIndexRef.current = null;
    timedProgressRef.current = null;
    if (finishedIndex + 1 >= stepsRef.current.length) {
      sessionLockRef.current = false;
      setPlaybackState("completed");
      setRemainingSeconds(0);
      return;
    }
    activeStepIndexRef.current = finishedIndex + 1;
    setStepIndex(finishedIndex + 1);
  }, []);

  const playFragment = useCallback((url: string, onEnded: (() => void) | undefined, sessionId: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (sessionId === activeSessionIdRef.current) onEnded?.();
    };
    audio.onended = finish;
    audio.onerror = () => {
      if (sessionId === activeSessionIdRef.current) setPlaybackError(true);
      finish();
    };
    audio.src = url;
    audio.load();
    void audio.play().catch(() => {
      if (sessionId === activeSessionIdRef.current) setPlaybackError(true);
      finish();
    });
  }, []);

  useEffect(() => {
    if (playbackState !== "running" || !currentStep) return;

    if (currentStep.type === "audio") {
      const url = currentStep.fragment.url;
      if (!url) {
        const sessionId = activeSessionIdRef.current;
        const timeout = window.setTimeout(() => advanceFrom(stepIndex, sessionId), 3000);
        return () => window.clearTimeout(timeout);
      }
      if (activeAudioIndexRef.current === stepIndex) return;

      const audio = audioRef.current;
      activeAudioIndexRef.current = stepIndex;
      const sessionId = activeSessionIdRef.current;
      playFragment(url, () => advanceFrom(stepIndex, sessionId), sessionId);
      return () => {
        if (audio) {
          audio.onended = null;
          audio.onerror = null;
        }
      };
    }

    const durationMs = currentStep.seconds * 1000;
    let progress = timedProgressRef.current;
    if (!progress || progress.index !== stepIndex) {
      progress = {
        index: stepIndex,
        startedAt: Date.now(),
        elapsedBeforePause: 0,
        durationMs,
        midpointPlayed: false,
      };
      timedProgressRef.current = progress;
    } else if (progress.startedAt === null) {
      progress.startedAt = Date.now();
    }

    const tick = () => {
      const activeProgress = timedProgressRef.current;
      if (!activeProgress) return;
      const elapsed = activeProgress.elapsedBeforePause
        + (activeProgress.startedAt === null ? 0 : Date.now() - activeProgress.startedAt);
      const remaining = Math.max(0, activeProgress.durationMs - elapsed);
      setRemainingSeconds(Math.ceil(remaining / 1000));

      if (currentStep.type === "timer" && currentStep.midpoint && !activeProgress.midpointPlayed
        && elapsed >= currentStep.midpoint.atSeconds * 1000) {
        activeProgress.midpointPlayed = true;
        setMidpoint({ index: stepIndex, phase: "playing" });
        const finishMidpoint = () => setMidpoint((prev) => (
          prev?.index === stepIndex ? { index: stepIndex, phase: "after" } : prev
        ));
        const midpointUrl = currentStep.midpoint.audio.fragment.url;
        if (midpointUrl) {
          playFragment(midpointUrl, finishMidpoint, activeSessionIdRef.current);
        } else {
          // Without audio, show the halfway text for roughly as long as it would take to say it.
          window.setTimeout(finishMidpoint, estimateSpeechSeconds(currentStep.midpoint.audio.text) * 1000);
        }
      }

      if (remaining <= 0) {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.onended = null;
          audio.onerror = null;
        }
        timedProgressRef.current = null;
        advanceFrom(stepIndex, activeSessionIdRef.current);
      }
    };

    tick();
    const interval = window.setInterval(tick, 200);
    return () => window.clearInterval(interval);
  }, [advanceFrom, currentStep, playbackState, playFragment, stepIndex]);

  useEffect(() => {
    const url = getStepAudioUrl(steps[stepIndex + 1]);
    if (!url || preloadedUrls.has(url)) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "audio";
    link.href = url;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
    preloadedUrls.add(url);
  }, [stepIndex, steps]);

  useEffect(() => {
    if (playbackState !== "running" && playbackState !== "paused") return;
    let disposed = false;
    const nav = navigator as NavigatorWithWakeLock;
    const requestWakeLock = async () => {
      if (!nav.wakeLock || wakeLockRef.current) return;
      try {
        const lock = await nav.wakeLock.request("screen");
        if (disposed) {
          await lock.release();
        } else {
          wakeLockRef.current = lock;
        }
      } catch {
        // Screen Wake Lock is optional and may be denied or unsupported.
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) void requestWakeLock();
    };
    void requestWakeLock();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      if (lock) void lock.release().catch(() => undefined);
    };
  }, [playbackState]);

  function changeHold(value: string) {
    const parsed = Number(value) as ChosenHoldSeconds;
    if (!holdChoices.includes(parsed)) return;
    setSelectedHold(parsed);
    try {
      window.localStorage.setItem(HOLD_STORAGE_KEY, String(parsed));
    } catch {
      // Continue with the in-memory selection when storage is unavailable.
    }
  }

  function startSession() {
    if (sessionLockRef.current) return;
    sessionLockRef.current = true;
    const sessionId = activeSessionIdRef.current + 1;
    activeSessionIdRef.current = sessionId;
    completedStepsRef.current.clear();
    const randomSeed = Date.now();
    const plan = buildSessionPlan(exercise, fragments, {
      lang,
      voice,
      chosenHoldSeconds: isDurationUserSelected ? selectedHold : exercise.hold_seconden as ChosenHoldSeconds,
      randomSeed,
    });
    const sessionSteps = testMode ? applyTestDurations(plan.steps, lang) : plan.steps;
    stepsRef.current = sessionSteps;
    activeStepIndexRef.current = 0;
    setSteps(sessionSteps);
    setStepIndex(0);
    setMidpoint(null);
    setPlaybackError(false);
    setRemainingSeconds(0);
    timedProgressRef.current = null;
    activeAudioIndexRef.current = null;

    const firstStep = sessionSteps[0];
    if (firstStep?.type === "audio" && firstStep.fragment.url) {
      activeAudioIndexRef.current = 0;
      playFragment(firstStep.fragment.url, () => advanceFrom(0, sessionId), sessionId);
    }
    if (sessionSteps.length > 0) {
      setPlaybackState("running");
    } else {
      sessionLockRef.current = false;
      setPlaybackState("completed");
    }
  }

  function pauseSession() {
    const progress = timedProgressRef.current;
    if (progress?.startedAt !== null && progress?.startedAt !== undefined) {
      progress.elapsedBeforePause += Date.now() - progress.startedAt;
      progress.startedAt = null;
    }
    audioRef.current?.pause();
    setPlaybackState("paused");
  }

  function resumeSession() {
    const sessionId = activeSessionIdRef.current;
    const progress = timedProgressRef.current;
    if (progress) progress.startedAt = Date.now();
    setPlaybackState("running");
    // The halfway fragment is not resumed after a pause, so its text must not stay on screen.
    setMidpoint((prev) => (prev?.phase === "playing" ? { ...prev, phase: "after" } : prev));
    if (currentStep?.type === "audio" && currentStep.fragment.url && audioRef.current) {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        advanceFrom(stepIndex, sessionId);
      };
      audioRef.current.onended = finish;
      audioRef.current.onerror = () => {
        setPlaybackError(true);
        finish();
      };
      void audioRef.current.play().catch(() => {
        setPlaybackError(true);
        finish();
      });
    }
  }

  function stopSession() {
    activeSessionIdRef.current += 1;
    sessionLockRef.current = false;
    completedStepsRef.current.clear();
    audioRef.current?.pause();
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    activeAudioIndexRef.current = null;
    activeStepIndexRef.current = 0;
    timedProgressRef.current = null;
    stepsRef.current = [];
    setSteps([]);
    setStepIndex(0);
    setMidpoint(null);
    setRemainingSeconds(0);
    setPlaybackState("ready");
  }

  const isTimed = currentStep?.type === "timer" || currentStep?.type === "wait";
  // Only the fragment that is sounding right now is shown; timed steps have no text of their own.
  const activeMidpoint = currentStep?.type === "timer" && currentStep.midpoint && midpoint?.index === stepIndex
    ? midpoint.phase
    : null;
  const displayedSubtitle = currentStep?.type === "audio"
    ? currentStep.text
    : activeMidpoint === "playing" && currentStep?.type === "timer"
      ? currentStep.midpoint?.audio.text ?? ""
      : activeMidpoint === "after"
        ? t.keepGoing
        : "";

  return (
    <section className="mt-8 rounded-2xl border border-teal-100 bg-teal-50 p-5 sm:p-6" aria-label={exercise.titel}>
      <audio ref={audioRef} preload="auto" className="hidden" aria-hidden="true" />
      <h3 className="text-2xl font-semibold text-slate-800">{t.heading}</h3>

      {testMode && (
        <p className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
          {t.testMode}
        </p>
      )}

      {exercise.nummer === 8 ? (
        <p className="mt-4 rounded-xl bg-amber-50 p-4 text-lg text-amber-900">{t.unsupported}</p>
      ) : playbackState === "ready" ? (
        <div className="mt-5 space-y-5">
          <p className="text-sm leading-relaxed text-slate-600">{t.setHelp(restSeconds)}</p>
          {isDurationUserSelected && (
            <label className="block text-lg font-medium text-slate-700">
              {t.chooseDuration}
              <select
                value={selectedHold}
                onChange={(event) => changeHold(event.target.value)}
                className="mt-2 block min-h-14 w-full rounded-xl border-2 border-teal-300 bg-white px-4 text-xl text-slate-900 focus:outline-none focus:ring-4 focus:ring-teal-200"
              >
                {holdChoices.map((seconds) => (
                  <option key={seconds} value={seconds}>{t.duration(seconds)}</option>
                ))}
              </select>
            </label>
          )}
          <p className="text-lg font-medium text-slate-700">
            {lang === "nl" ? "Verwachte duur:" : "Estimated duration:"} {t.estimate(estimatedMinutes)}
          </p>
          <button
            type="button"
            onClick={startSession}
            className="min-h-16 w-full rounded-2xl bg-teal-700 px-6 py-4 text-xl font-bold text-white shadow-sm transition-colors hover:bg-teal-800 focus:outline-none focus:ring-4 focus:ring-teal-300"
          >
            {t.start}
          </button>
        </div>
      ) : playbackState === "completed" ? (
        <div className="mt-5 space-y-5">
          <p className="text-xl font-semibold text-teal-900" role="status">{t.completed}</p>
          <button
            type="button"
            onClick={stopSession}
            className="min-h-14 w-full rounded-xl bg-teal-700 px-5 py-3 text-lg font-bold text-white hover:bg-teal-800 focus:outline-none focus:ring-4 focus:ring-teal-300"
          >
            {t.restart}
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-5" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {currentStep?.setNumber !== undefined && (
              <p className="text-lg font-semibold text-teal-900">{t.set(currentStep.setNumber, exercise.sets)}</p>
            )}
            {currentStep && <p className="text-base font-medium text-slate-600">{currentStep.type === "timer" || currentStep.type === "wait" ? currentStep.label : ""}</p>}
          </div>
          {isTimed && (
            <p className="text-center text-7xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-8xl" aria-label={`${remainingSeconds} seconds remaining`}>
              {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}
            </p>
          )}
          <div className="flex min-h-24 items-center justify-center rounded-2xl bg-white px-5 py-4 text-center text-xl font-medium leading-relaxed text-slate-800 ring-1 ring-teal-100">
            {displayedSubtitle || (lang === "nl" ? "Volg de aanwijzingen." : "Follow the instructions.")}
          </div>
          {playbackError && <p className="text-base text-amber-800" role="status">{t.playbackError}</p>}
          <div className="grid grid-cols-2 gap-3">
            {playbackState === "running" ? (
              <button type="button" onClick={pauseSession} className="min-h-16 rounded-xl border-2 border-teal-700 bg-white px-4 py-3 text-xl font-bold text-teal-900 hover:bg-teal-50 focus:outline-none focus:ring-4 focus:ring-teal-200">
                {t.pause}
              </button>
            ) : (
              <button type="button" onClick={resumeSession} className="min-h-16 rounded-xl border-2 border-teal-700 bg-white px-4 py-3 text-xl font-bold text-teal-900 hover:bg-teal-50 focus:outline-none focus:ring-4 focus:ring-teal-200">
                {t.resume}
              </button>
            )}
            <button type="button" onClick={stopSession} className="min-h-16 rounded-xl bg-slate-200 px-4 py-3 text-xl font-bold text-slate-900 hover:bg-slate-300 focus:outline-none focus:ring-4 focus:ring-slate-300">
              {t.stop}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
