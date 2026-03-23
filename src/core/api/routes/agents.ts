import type { Router } from "../router.js";
import type { RouteDeps } from "../index.js";
import { getAgentCapabilities } from "../../agent-registry.js";

export function registerAgentRoutes(router: Router, deps: RouteDeps): void {
  router.get("/api/agents", async (_req, res) => {
    const agents = deps.core.agentManager.getAvailableAgents();
    const defaultAgent = deps.core.configManager.get().defaultAgent;
    const agentsWithCaps = agents.map((a) => ({
      ...a,
      capabilities: getAgentCapabilities(a.name),
    }));
    deps.sendJson(res, 200, { agents: agentsWithCaps, default: defaultAgent });
  });
}
