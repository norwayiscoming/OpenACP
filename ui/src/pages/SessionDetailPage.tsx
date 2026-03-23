import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { api } from "../api/client";
import { useEventStream } from "../contexts/event-stream-context";
import type { SessionDetail } from "../api/types";
import { StatusBadge } from "../components/shared/StatusBadge";
import { Button } from "../components/shared/Button";
import { Toggle } from "../components/shared/Toggle";
import { Card } from "../components/shared/Card";
import { formatRelativeTime } from "../lib/format";

interface AgentEventEntry {
  id: number;
  type: string;
  content: string;
  timestamp: Date;
}

interface PendingPermission {
  sessionId: string;
  permission: {
    id: string;
    description: string;
    options: Array<{ id: string; label: string; isAllow: boolean }>;
  };
}

const MAX_EVENTS = 500;

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [events, setEvents] = useState<AgentEventEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef(0);
  const { subscribe } = useEventStream();

  useEffect(() => {
    if (!id) return;
    api
      .get<{ session: SessionDetail }>(
        `/api/sessions/${encodeURIComponent(id)}`,
      )
      .then((data) => setSession(data.session))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const unsub1 = subscribe("agent:event", (data) => {
      const d = data as {
        sessionId: string;
        event: {
          type: string;
          content?: string;
          message?: string;
          name?: string;
          status?: string;
        };
      };
      if (d.sessionId !== id) return;
      let content = "";
      switch (d.event.type) {
        case "text":
          content = d.event.content ?? "";
          break;
        case "thought":
          content = `\u{1F4AD} ${d.event.content ?? ""}`;
          break;
        case "tool_call":
          content = `\u{1F527} ${d.event.name ?? "tool"} \u2014 ${d.event.status ?? ""}`;
          break;
        case "tool_update":
          content = `\u{1F527} ${d.event.name ?? "tool"} \u2014 ${d.event.status ?? ""}`;
          break;
        case "error":
          content = `\u274C ${d.event.message ?? ""}`;
          break;
        case "session_end":
          content = `\u2705 Session ended`;
          break;
        case "usage":
          content = `\u{1F4CA} Token usage updated`;
          break;
        default:
          content = JSON.stringify(d.event);
      }
      counterRef.current += 1;
      const newEntry: AgentEventEntry = {
        id: counterRef.current,
        type: d.event.type,
        content,
        timestamp: new Date(),
      };
      setEvents((prev) => {
        const next = [...prev, newEntry];
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      });
    });

    const unsub2 = subscribe("session:updated", (data) => {
      const d = data as Partial<SessionDetail> & { sessionId: string };
      if (d.sessionId !== id) return;
      setSession((prev) => (prev ? { ...prev, ...d } : prev));
    });

    const unsub3 = subscribe("permission:request", (data) => {
      const d = data as PendingPermission;
      if (d.sessionId !== id) return;
      setPermission(d);
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [subscribe, id]);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const handleSendPrompt = useCallback(async () => {
    if (!prompt.trim() || !id) return;
    setSending(true);
    try {
      await api.post(`/api/sessions/${encodeURIComponent(id)}/prompt`, {
        prompt: prompt.trim(),
      });
      setPrompt("");
    } catch (err) {
      setError(`Failed to send prompt: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }, [prompt, id]);

  const handleCancel = useCallback(async () => {
    if (!id || !confirm("Cancel this session?")) return;
    try {
      await api.del(`/api/sessions/${encodeURIComponent(id)}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  const handleToggleDangerous = useCallback(
    async (enabled: boolean) => {
      if (!id) return;
      try {
        await api.patch(`/api/sessions/${encodeURIComponent(id)}/dangerous`, {
          enabled,
        });
        setSession((prev) =>
          prev ? { ...prev, dangerousMode: enabled } : prev,
        );
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [id],
  );

  const handlePermissionResponse = useCallback(
    async (optionId: string) => {
      if (!id || !permission) return;
      try {
        await api.post(`/api/sessions/${encodeURIComponent(id)}/permission`, {
          permissionId: permission.permission.id,
          optionId,
        });
        setPermission(null);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [id, permission],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendPrompt();
      }
    },
    [handleSendPrompt],
  );

  if (loading) return <div className="text-zinc-500">Loading session...</div>;
  if (error) return <div className="text-red-500">Error: {error}</div>;
  if (!session) return <div className="text-zinc-500">Session not found</div>;

  const isActive =
    session.status === "active" || session.status === "initializing";

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/sessions")}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            &larr; Back
          </button>
          <h1 className="text-xl font-semibold">
            {session.name ?? session.id.slice(0, 8)}
          </h1>
          <StatusBadge status={session.status} />
        </div>
        <div className="flex items-center gap-3">
          <Toggle
            checked={session.dangerousMode}
            onChange={handleToggleDangerous}
            label="Dangerous"
            disabled={!isActive}
          />
          {isActive && (
            <Button variant="danger" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="flex gap-4 text-xs text-zinc-500 shrink-0">
        <span>
          Agent:{" "}
          <strong className="text-zinc-700 dark:text-zinc-300">
            {session.agent}
          </strong>
        </span>
        <span>
          Workspace:{" "}
          <strong className="font-mono text-zinc-700 dark:text-zinc-300">
            {session.workspace}
          </strong>
        </span>
        <span>Created: {formatRelativeTime(session.createdAt)}</span>
        {session.promptRunning && (
          <span className="text-yellow-500">Processing...</span>
        )}
        {session.queueDepth > 0 && <span>Queue: {session.queueDepth}</span>}
      </div>

      {/* Permission request */}
      {permission && (
        <Card className="border-yellow-500 shrink-0">
          <div className="space-y-2">
            <p className="text-sm font-medium">Permission Request</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {permission.permission.description}
            </p>
            <div className="flex gap-2">
              {permission.permission.options.map((opt) => (
                <Button
                  key={opt.id}
                  variant={opt.isAllow ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => handlePermissionResponse(opt.id)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Event stream */}
      <div className="flex-1 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 font-mono text-xs min-h-0">
        {events.length === 0 ? (
          <div className="text-zinc-500 text-center py-8">
            {isActive ? "Waiting for agent events..." : "No events recorded"}
          </div>
        ) : (
          <div className="space-y-1">
            {events.map((evt) => (
              <div
                key={evt.id}
                className={`whitespace-pre-wrap break-words ${
                  evt.type === "error"
                    ? "text-red-500"
                    : evt.type === "thought"
                      ? "text-zinc-400 italic"
                      : evt.type === "tool_call" || evt.type === "tool_update"
                        ? "text-blue-500 dark:text-blue-400"
                        : ""
                }`}
              >
                {evt.content}
              </div>
            ))}
            <div ref={eventsEndRef} />
          </div>
        )}
      </div>

      {/* Prompt input */}
      {isActive && (
        <div className="flex gap-2 shrink-0">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a prompt..."
            rows={2}
            className="flex-1 px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <Button
            variant="primary"
            onClick={handleSendPrompt}
            disabled={sending || !prompt.trim()}
          >
            {sending ? "..." : "Send"}
          </Button>
        </div>
      )}
    </div>
  );
}
