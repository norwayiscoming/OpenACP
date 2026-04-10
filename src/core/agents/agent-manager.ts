import type { AgentDefinition } from "../types.js";
import { AgentInstance } from "./agent-instance.js";
import type { AgentCatalog } from "./agent-catalog.js";

/**
 * High-level facade for spawning and resuming agent instances.
 *
 * Resolves agent names to definitions via AgentCatalog, then delegates
 * to AgentInstance for subprocess management. Used by SessionFactory
 * to create the agent backing a session.
 *
 * Agent switching (swapping the agent mid-session) is coordinated at the
 * Session layer — AgentManager only handles individual spawn/resume calls.
 */
export class AgentManager {
  constructor(private catalog: AgentCatalog) {}

  /** Return definitions for all installed agents. */
  getAvailableAgents(): AgentDefinition[] {
    const installed = this.catalog.getInstalledEntries();
    return Object.entries(installed).map(([key, agent]) => ({
      name: key,
      command: agent.command,
      args: agent.args,
      env: agent.env,
    }));
  }

  /** Look up a single agent definition by its short name (e.g., "claude", "gemini"). */
  getAgent(name: string): AgentDefinition | undefined {
    return this.catalog.resolve(name);
  }

  /**
   * Spawn a new agent subprocess with a fresh session.
   *
   * @throws If the agent is not installed — includes install instructions in the error message.
   */
  async spawn(
    agentName: string,
    workingDirectory: string,
    allowedPaths?: string[],
  ): Promise<AgentInstance> {
    const agentDef = this.getAgent(agentName);
    if (!agentDef) throw new Error(`Agent "${agentName}" is not installed. Run "openacp agents install ${agentName}" to add it.`);
    return AgentInstance.spawn(agentDef, workingDirectory, undefined, allowedPaths);
  }

  /**
   * Spawn a subprocess and resume an existing agent session.
   *
   * Falls back to a new session if the agent cannot restore the given session ID.
   */
  async resume(
    agentName: string,
    workingDirectory: string,
    agentSessionId: string,
    allowedPaths?: string[],
  ): Promise<AgentInstance> {
    const agentDef = this.getAgent(agentName);
    if (!agentDef) throw new Error(`Agent "${agentName}" is not installed. Run "openacp agents install ${agentName}" to add it.`);
    return AgentInstance.resume(agentDef, workingDirectory, agentSessionId, undefined, allowedPaths);
  }
}
