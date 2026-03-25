import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-white/20 dark:border-white/10 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xl shadow-sm hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 transition-all duration-300 ${className}`}
    >
      {title && (
        <div className="px-5 py-4 border-b border-white/20 dark:border-white/10 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {title}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
