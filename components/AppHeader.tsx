export function AppHeader() {
  return (
    <header className="border-b border-teal-100 bg-white">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4 sm:px-6">
        <svg viewBox="0 0 100 100" className="h-8 w-8 shrink-0" aria-hidden="true">
          <circle cx="50" cy="50" r="48" fill="#0d9488" />
          <path
            d="M20 50 L38 50 L45 35 L55 65 L62 50 L80 50"
            stroke="white"
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-xl font-semibold text-teal-800">StaticIso</span>
      </div>
    </header>
  );
}
