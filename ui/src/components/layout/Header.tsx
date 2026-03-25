import { useTheme } from "../../hooks/use-theme";

export function Header() {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="flex items-center justify-end h-16 px-6 border-b border-white/20 dark:border-white/5 bg-white/40 dark:bg-zinc-950/40 backdrop-blur-xl sticky top-0 z-20">
      <button
        onClick={toggleTheme}
        className="p-2.5 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-white/60 dark:hover:bg-zinc-800/60 transition-all duration-300 hover:scale-105 active:scale-95 shadow-sm border border-transparent hover:border-white/20 dark:hover:border-white/5"
        title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      >
        {theme === "light" ? "🌙" : "☀️"}
      </button>
    </header>
  );
}
