import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Card } from "../components/shared/Card";

interface AgentData {
  name: string;
  command: string;
  args: string[];
  workingDirectory?: string;
  capabilities: string[];
}

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [defaultAgent, setDefaultAgent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ agents: AgentData[]; default: string }>("/api/agents")
      .then((data) => {
        setAgents(data.agents);
        setDefaultAgent(data.default);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-zinc-500">Loading agents...</div>;
  if (error)
    return <div className="text-red-500">Failed to load agents: {error}</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Agents</h1>

      {agents.length === 0 ? (
        <div className="text-sm text-zinc-500 py-8 text-center">
          No agents configured. Add agents via CLI.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <Card key={agent.name} className="relative">
              {agent.name === defaultAgent && (
                <span className="absolute top-3 right-3 px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full font-medium">
                  Default
                </span>
              )}
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-base">{agent.name}</h3>
                  <p className="text-xs text-zinc-500 font-mono mt-1">
                    {agent.command} {agent.args.join(" ")}
                  </p>
                </div>

                {agent.workingDirectory && (
                  <div className="text-xs">
                    <span className="text-zinc-500">Working dir: </span>
                    <span className="font-mono">{agent.workingDirectory}</span>
                  </div>
                )}

                {agent.capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {agent.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded-full"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
