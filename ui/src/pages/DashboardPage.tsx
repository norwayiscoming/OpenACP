import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useEventStream } from "../api/use-event-stream";
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
    } catch {
      setRestarting(false);
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
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="System">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Version</span>
              <span className="font-mono">{health.version}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Uptime</span>
              <span>{formatDuration(health.uptime)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Memory (RSS)</span>
              <span>{formatBytes(health.memory.rss)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Heap Used</span>
              <span>
                {formatBytes(health.memory.heapUsed)} /{" "}
                {formatBytes(health.memory.heapTotal)}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Sessions">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Active</span>
              <span className="text-lg font-semibold">
                {health.sessions.active}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Total</span>
              <span>{health.sessions.total}</span>
            </div>
          </div>
        </Card>

        <Card title="Adapters">
          {health.adapters.length > 0 ? (
            <div className="space-y-1">
              {health.adapters.map((name) => (
                <div key={name} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  {name}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-zinc-500">No adapters registered</div>
          )}
        </Card>

        <Card title="Tunnel">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Status</span>
              <span
                className={
                  health.tunnel.enabled ? "text-green-500" : "text-zinc-400"
                }
              >
                {health.tunnel.enabled ? "Active" : "Disabled"}
              </span>
            </div>
            {health.tunnel.enabled && health.tunnel.url && (
              <div className="flex justify-between">
                <span className="text-zinc-500">URL</span>
                <a
                  href={health.tunnel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline font-mono text-xs truncate max-w-48"
                >
                  {health.tunnel.url}
                </a>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="flex gap-3">
        <Button variant="primary" onClick={() => navigate("/sessions")}>
          View Sessions
        </Button>
        <Button variant="danger" onClick={handleRestart} disabled={restarting}>
          {restarting ? "Restarting..." : "Restart Server"}
        </Button>
      </div>
    </div>
  );
}
