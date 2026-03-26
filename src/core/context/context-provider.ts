// NOTE: This interface is designed around Entire as the first provider.
// It may evolve when additional providers (Cursor history, Zed, etc.) are added.
// Providers may only support a subset of query types and should return empty results
// for unsupported types rather than throwing.

export interface ContextProvider {
  readonly name: string;
  isAvailable(repoPath: string): Promise<boolean>;
  listSessions(query: ContextQuery): Promise<SessionListResult>;
  buildContext(query: ContextQuery, options?: ContextOptions): Promise<ContextResult>;
}

export interface ContextQuery {
  repoPath: string;
  type: "branch" | "commit" | "pr" | "latest" | "checkpoint" | "session";
  value: string;
}

export interface ContextOptions {
  maxTokens?: number;
  limit?: number;
}

export interface SessionInfo {
  checkpointId: string;
  sessionIndex: string;
  transcriptPath: string;
  createdAt: string;
  endedAt: string;
  branch: string;
  agent: string;
  turnCount: number;
  filesTouched: string[];
  sessionId: string;
}

export interface SessionListResult {
  sessions: SessionInfo[];
  estimatedTokens: number;
}

export type ContextMode = "full" | "balanced" | "compact";

export interface ContextResult {
  markdown: string;
  tokenEstimate: number;
  sessionCount: number;
  totalTurns: number;
  mode: ContextMode;
  truncated: boolean;
  timeRange: { start: string; end: string };
}

export const DEFAULT_MAX_TOKENS = 30_000;
export const TOKENS_PER_TURN_ESTIMATE = 400;
