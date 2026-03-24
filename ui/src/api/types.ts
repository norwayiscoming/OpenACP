export type SessionStatus =
  | "initializing"
  | "active"
  | "cancelled"
  | "finished"
  | "error";

export interface SessionSummary {
  id: string;
  agent: string;
  status: SessionStatus;
  name: string | null;
  workspace: string;
  createdAt: string;
  dangerousMode: boolean;
  queueDepth: number;
  promptRunning: boolean;
  lastActiveAt: string | null;
}

export interface SessionDetail {
  id: string;
  agent: string;
  status: SessionStatus;
  name: string | null;
  workspace: string;
  createdAt: string;
  dangerousMode: boolean;
  queueDepth: number;
  promptRunning: boolean;
  threadId: string;
  channelId: string;
  agentSessionId: string;
}

export interface AgentInfo {
  name: string;
  command: string;
  args: string[];
  workingDirectory?: string;
  capabilities: string[];
}

export interface HealthData {
  status: string;
  uptime: number;
  version: string;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  sessions: { active: number; total: number };
  adapters: string[];
  tunnel: { enabled: boolean; url?: string };
}

export interface ConfigField {
  path: string;
  displayName: string;
  group: string;
  type: string;
  options?: string[];
  value: unknown;
  hotReload: boolean;
}

export interface TopicInfo {
  sessionId: string;
  name: string;
  status: string;
  createdAt: string;
}
