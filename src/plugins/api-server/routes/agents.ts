import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.js';
import { NameParamSchema } from '../schemas/common.js';
import { NotFoundError } from '../middleware/error-handler.js';
import { requireScopes } from '../middleware/auth.js';
import { getAgentCapabilities } from '../../../core/agents/agent-registry.js';

export async function agentRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  // GET /agents — list all available agents
  app.get('/', { preHandler: requireScopes('agents:read') }, async () => {
    const agents = deps.core.agentManager.getAvailableAgents();
    const defaultAgent = deps.core.configManager.get().defaultAgent;
    const agentsWithCaps = agents.map((a) => ({
      ...a,
      capabilities: getAgentCapabilities(a.name),
    }));
    return { agents: agentsWithCaps, default: defaultAgent };
  });

  // GET /agents/:name — get a single agent by name
  app.get('/:name', { preHandler: requireScopes('agents:read') }, async (request) => {
    const { name } = NameParamSchema.parse(request.params);
    const agent = deps.core.agentCatalog.getInstalledAgent(name);
    if (!agent) {
      throw new NotFoundError('AGENT_NOT_FOUND', `Agent "${name}" not found`);
    }
    return {
      ...agent,
      key: name,
      capabilities: getAgentCapabilities(name),
    };
  });
}
