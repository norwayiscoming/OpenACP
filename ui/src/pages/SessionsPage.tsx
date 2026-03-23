import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useEventStream } from "../contexts/event-stream-context";
import type { SessionSummary, SessionStatus } from "../api/types";
import { StatusBadge } from "../components/shared/StatusBadge";
import { Button } from "../components/shared/Button";
import { Modal } from "../components/shared/Modal";
import { formatRelativeTime } from "../lib/format";

const STATUS_FILTERS: Array<SessionStatus | "all"> = [
  "all",
  "active",
  "initializing",
  "finished",
  "error",
  "cancelled",
];

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [filter, setFilter] = useState<SessionStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [agents, setAgents] = useState<Array<{ name: string }>>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { subscribe } = useEventStream();

  useEffect(() => {
    api
      .get<{ sessions: SessionSummary[] }>("/api/sessions")
      .then((data) => setSessions(data.sessions))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const unsub1 = subscribe("session:created", (data) => {
      const raw = data as unknown as Record<string, unknown>;
      const session: SessionSummary = {
        id: (raw.id ?? raw.sessionId) as string,
        agent: raw.agent as string,
        status: (raw.status ?? "initializing") as SessionSummary["status"],
        name: (raw.name as string | null) ?? null,
        workspace: (raw.workspace as string) ?? "",
        createdAt: (raw.createdAt as string) ?? new Date().toISOString(),
        dangerousMode: (raw.dangerousMode as boolean) ?? false,
        queueDepth: (raw.queueDepth as number) ?? 0,
        promptRunning: (raw.promptRunning as boolean) ?? false,
        lastActiveAt: (raw.lastActiveAt as string | null) ?? null,
      };
      setSessions((prev) => [session, ...prev]);
    });
    const unsub2 = subscribe("session:updated", (data) => {
      const d = data as Partial<SessionSummary> & { sessionId: string };
      setSessions((prev) =>
        prev.map((s) => (s.id === d.sessionId ? { ...s, ...d } : s)),
      );
    });
    const unsub3 = subscribe("session:deleted", (data) => {
      const d = data as { sessionId: string };
      setSessions((prev) => prev.filter((s) => s.id !== d.sessionId));
    });
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [subscribe]);

  const handleCancel = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Cancel this session?")) return;
    try {
      await api.del(`/api/sessions/${encodeURIComponent(id)}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const body = selectedAgent ? { agent: selectedAgent } : {};
      await api.post("/api/sessions", body);
      setShowCreate(false);
      setSelectedAgent("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }, [selectedAgent]);

  const openCreateModal = useCallback(async () => {
    try {
      const data = await api.get<{
        agents: Array<{ name: string }>;
        default: string;
      }>("/api/agents");
      setAgents(data.agents);
      setSelectedAgent(data.default);
    } catch {
      /* ignore */
    }
    setShowCreate(true);
  }, []);

  const filtered =
    filter === "all" ? sessions : sessions.filter((s) => s.status === filter);

  if (loading) return <div className="text-zinc-500">Loading sessions...</div>;
  if (error) return <div className="text-red-500">Error: {error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Sessions</h1>
        <Button variant="primary" onClick={openCreateModal}>
          New Session
        </Button>
      </div>

      <div className="flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filter === s
                ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-zinc-500 py-8 text-center">
          No sessions found
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Agent</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Created</th>
                <th className="text-left px-4 py-2 font-medium">Queue</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filtered.map((session) => (
                <tr
                  key={session.id}
                  onClick={() => navigate(`/sessions/${session.id}`)}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 cursor-pointer"
                >
                  <td className="px-4 py-2">
                    <span className="font-medium">
                      {session.name ?? session.id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{session.agent}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={session.status} />
                  </td>
                  <td className="px-4 py-2 text-zinc-500">
                    {formatRelativeTime(session.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">
                    {session.queueDepth}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {(session.status === "active" ||
                      session.status === "initializing") && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={(e) => handleCancel(session.id, e)}
                      >
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Session"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Agent</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
            >
              {agents.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
