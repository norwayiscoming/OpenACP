import type { AgentDefinition } from "./types.js";
import { AgentInstance } from "./agent-instance.js";
import type { AgentCatalog } from "./agent-catalog.js";

export class AgentManager {
  constructor(private catalog: AgentCatalog) {}

  getAvailableAgents(): AgentDefinition[] {
    const installed = this.catalog.getInstalledEntries();
    return Object.entries(installed).map(([key, agent]) => ({
      name: key,
      command: agent.command,
      args: agent.args,
      env: agent.env,
    }));
  }

  getAgent(name: string): AgentDefinition | undefined {
    return this.catalog.resolve(name);
  }

  async spawn(
    agentName: string,
    workingDirectory: string,
  ): Promise<AgentInstance> {
    const agentDef = this.getAgent(agentName);
    if (!agentDef) throw new Error(`Agent "${agentName}" is not installed. Run "openacp agents install ${agentName}" to add it.`);
    return AgentInstance.spawn(agentDef, workingDirectory);
  }

  async resume(
    agentName: string,
    workingDirectory: string,
    agentSessionId: string,
  ): Promise<AgentInstance> {
    const agentDef = this.getAgent(agentName);
    if (!agentDef) throw new Error(`Agent "${agentName}" is not installed. Run "openacp agents install ${agentName}" to add it.`);
    return AgentInstance.resume(agentDef, workingDirectory, agentSessionId);
  }
}
