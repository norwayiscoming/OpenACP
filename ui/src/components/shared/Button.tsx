import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
}

const VARIANTS = {
  primary: "bg-gradient-to-r from-primary to-indigo-500 text-white shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-0.5 border border-transparent",
  secondary:
    "bg-white/50 dark:bg-zinc-800/50 text-zinc-900 dark:text-zinc-100 hover:bg-white/80 dark:hover:bg-zinc-700/80 backdrop-blur-sm border border-white/20 dark:border-white/5 shadow-sm hover:-translate-y-0.5",
  danger: "bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-md shadow-red-500/20 hover:shadow-lg hover:shadow-red-500/30 hover:-translate-y-0.5 border border-transparent",
};

const SIZES = {
  sm: "px-3 py-1.5 text-xs rounded-lg",
  md: "px-4 py-2 text-sm rounded-xl",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none active:scale-95 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
