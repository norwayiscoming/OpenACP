import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client";
import { Button } from "../components/shared/Button";

interface TopicData {
  sessionId: string;
  name: string;
  status: string;
  createdAt?: string;
}

export function TopicsPage() {
  const [topics, setTopics] = useState<TopicData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const fetchTopics = useCallback(async () => {
    try {
      const data = await api.get<{ topics: TopicData[] }>("/api/topics");
      setTopics(data.topics);
      setError(null);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("not available")) {
        setError(
          "Topic management is not available. Telegram adapter may not be enabled.",
        );
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  const handleDelete = useCallback(
    async (sessionId: string, isActive: boolean) => {
      if (isActive) {
        if (!confirm("This session is still active. Force delete the topic?"))
          return;
      }
      try {
        const url = isActive
          ? `/api/topics/${encodeURIComponent(sessionId)}?force=true`
          : `/api/topics/${encodeURIComponent(sessionId)}`;
        await api.del(url);
        await fetchTopics();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [fetchTopics],
  );

  const handleCleanup = useCallback(async () => {
    if (!confirm("Delete all finished and error topics?")) return;
    setCleaning(true);
    try {
      await api.post("/api/topics/cleanup", {
        statuses: ["finished", "error"],
      });
      await fetchTopics();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCleaning(false);
    }
  }, [fetchTopics]);

  if (loading) return <div className="text-zinc-500">Loading topics...</div>;
  if (error)
    return <div className="text-zinc-500 py-8 text-center">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Topics</h1>
        <Button variant="secondary" onClick={handleCleanup} disabled={cleaning}>
          {cleaning ? "Cleaning..." : "Cleanup Finished"}
        </Button>
      </div>

      {topics.length === 0 ? (
        <div className="text-sm text-zinc-500 py-8 text-center">
          No topics found
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Session ID</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {topics.map((topic) => (
                <tr
                  key={topic.sessionId}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                >
                  <td className="px-4 py-2 font-medium">{topic.name}</td>
                  <td className="px-4 py-2 text-zinc-500 font-mono text-xs">
                    {topic.sessionId}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        topic.status === "active"
                          ? "text-green-500"
                          : topic.status === "error"
                            ? "text-red-500"
                            : "text-zinc-400"
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          topic.status === "active"
                            ? "bg-green-500"
                            : topic.status === "error"
                              ? "bg-red-500"
                              : "bg-zinc-400"
                        }`}
                      />
                      {topic.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        handleDelete(topic.sessionId, topic.status === "active")
                      }
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
