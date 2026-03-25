interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className="inline-flex items-center gap-3 cursor-pointer group">
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-all duration-300 shadow-inner ${checked ? "bg-primary shadow-primary/20" : "bg-zinc-300/80 dark:bg-zinc-700/80"
          } ${disabled ? "opacity-50 cursor-not-allowed" : "group-hover:scale-105"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${checked ? "translate-x-5" : ""
            }`}
        />
      </button>
      {label && <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 select-none">{label}</span>}
    </label>
  );
}
