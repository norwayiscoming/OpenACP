import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useEventStream } from "../contexts/event-stream-context";
import type { HealthData } from "../api/types";
import { Card } from "../components/shared/Card";
import { Button } from "../components/shared/Button";
import { formatDuration, formatBytes } from "../lib/format";

export function DashboardPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const navigate = useNavigate();
  const { subscribe } = useEventStream();

  useEffect(() => {
    api
      .get<HealthData>("/api/health")
      .then((data) => setHealth(data))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    return subscribe("health", (data) => {
      setHealth((prev) =>
        prev ? { ...prev, ...(data as Partial<HealthData>) } : prev,
      );
    });
  }, [subscribe]);

  const handleRestart = useCallback(async () => {
    if (
      !confirm(
        "Are you sure you want to restart the server? All active sessions will be interrupted.",
      )
    )
      return;
    setRestarting(true);
    try {
      await api.post("/api/restart");
    } catch (err) {
      setRestarting(false);
      setError(`Restart failed: ${(err as Error).message}`);
    }
  }, []);

  if (error) {
    return (
      <div className="text-red-500">Failed to load health data: {error}</div>
    );
  }

  if (!health) {
    return <div className="text-zinc-500">Loading...</div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-zinc-900 to-zinc-500 dark:from-white dark:to-zinc-500 bg-clip-text text-transparent drop-shadow-sm">
          Overview
        </h1>
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => navigate("/sessions")}>
            View Sessions
          </Button>
          <Button
            variant="danger"
            onClick={handleRestart}
            disabled={restarting}
          >
            {restarting ? "Restarting..." : "Restart Server"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="System">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between items-center py-2 border-b border-black/5 dark:border-white/5 last:border-0">
              <span className="text-zinc-500 font-medium tracking-wide text-xs uppercase">
                Version
              </span>
              <span className="font-mono font-medium">{health.version}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-black/5 dark:border-white/5 last:border-0">
              <span className="text-zinc-500 font-medium tracking-wide text-xs uppercase">
                Uptime
              </span>
              <span className="font-medium">
                {formatDuration(health.uptime)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-black/5 dark:border-white/5 last:border-0">
              <span className="text-zinc-500 font-medium tracking-wide text-xs uppercase">
                Memory (RSS)
              </span>
              <span className="font-medium">
                {formatBytes(health.memory.rss)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-black/5 dark:border-white/5 last:border-0">
              <span className="text-zinc-500 font-medium tracking-wide text-xs uppercase">
                Heap Used
              </span>
              <span className="font-medium">
                {formatBytes(health.memory.heapUsed)}{" "}
                <span className="text-zinc-400">/</span>{" "}
                {formatBytes(health.memory.heapTotal)}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Sessions">
          <div className="space-y-1 text-sm h-full flex flex-col justify-center">
            <div className="flex justify-between items-center py-3 border-b border-black/5 dark:border-white/5 last:border-0">
              <span className="text-zinc-500 font-medium tracking-wide text-xs uppercase">
                Active Now
              </span>
              <span className="text-4xl font-black bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent drop-shadow-sm">
                {health.sessions.active}
              </span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-black/5 dark:border-white/5 last:border-0">
              <span className="text-zinc-500 font-medium tracking-wide text-xs uppercase">
                Total Handled
              </span>
              <span className="text-xl font-bold text-zinc-700 dark:text-zinc-300">
                {health.sessions.total}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Adapters">
          {health.adapters.length > 0 ? (
            <div className="space-y-2">
              {health.adapters.map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-3 text-sm p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-success shadow-sm shadow-success/50" />
                  <span className="font-medium">{name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-zinc-500 italic p-4 text-center rounded-xl bg-black/5 dark:bg-white/5">
              No adapters registered
            </div>
          )}
        </Card>

        <Card title="Tunnel">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between items-center py-3 border-b border-black/5 dark:border-white/5 last:border-0">
              <span className="text-zinc-500 font-medium tracking-wide text-xs uppercase">
                Status
              </span>
              <span
                className={`font-semibold px-2.5 py-1 rounded-full text-xs ${
                  health.tunnel.enabled
                    ? "bg-success/10 text-success border border-success/20"
                    : "bg-black/5 dark:bg-white/5 text-zinc-500"
                }`}
              >
                {health.tunnel.enabled ? "Active" : "Disabled"}
              </span>
            </div>
            {health.tunnel.enabled && health.tunnel.url && (
              <div className="flex justify-between items-center py-3 border-b border-black/5 dark:border-white/5 last:border-0">
                <span className="text-zinc-500 font-medium tracking-wide text-xs uppercase">
                  URL
                </span>
                <a
                  href={health.tunnel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary-hover hover:underline font-mono text-xs truncate max-w-48 bg-primary/10 px-2 py-1 rounded-md"
                >
                  {health.tunnel.url}
                </a>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
