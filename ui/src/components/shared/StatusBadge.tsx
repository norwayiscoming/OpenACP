import type { SessionStatus } from "../../api/types";

const STATUS_COLORS: Record<SessionStatus, string> = {
  initializing: "bg-warning shadow-warning/50 animate-pulse",
  active: "bg-success shadow-success/50",
  cancelled: "bg-zinc-400 shadow-zinc-400/50",
  finished: "bg-primary shadow-primary/50",
  error: "bg-danger shadow-danger/50",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-white/50 dark:bg-zinc-800/50 border border-white/20 dark:border-white/5 backdrop-blur-sm shadow-sm">
      <span className={`w-2 h-2 rounded-full shadow-sm ${STATUS_COLORS[status]}`} />
      {status}
    </span>
  );
}
