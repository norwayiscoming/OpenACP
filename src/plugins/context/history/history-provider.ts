import type { SessionRecord } from "../../../core/types.js";
import type {
  ContextProvider,
  ContextQuery,
  ContextOptions,
  ContextResult,
  ContextMode,
  SessionInfo,
  SessionListResult,
} from "../context-provider.js";
import { DEFAULT_MAX_TOKENS, TOKENS_PER_TURN_ESTIMATE } from "../context-provider.js";
import { HistoryStore } from "./history-store.js";
import {
  buildHistoryMarkdown,
  selectLevel,
  estimateTokens,
} from "./history-context-builder.js";

const EMPTY_RESULT: ContextResult = {
  markdown: "",
  tokenEstimate: 0,
  sessionCount: 0,
  totalTurns: 0,
  mode: "full",
  truncated: false,
  timeRange: { start: "", end: "" },
};

export class HistoryProvider implements ContextProvider {
  readonly name = "local";

  constructor(
    private readonly store: HistoryStore,
    private readonly getSessionRecords: () => SessionRecord[]
  ) {}

  async isAvailable(_repoPath: string): Promise<boolean> {
    return true;
  }

  async listSessions(query: ContextQuery): Promise<SessionListResult> {
    if (!this.isSupportedType(query.type)) {
      return { sessions: [], estimatedTokens: 0 };
    }

    const candidates = await this.resolveCandidates(query);
    const sessions: SessionInfo[] = [];
    let estimatedTokens = 0;

    for (const record of candidates) {
      const history = await this.store.read(record.sessionId);
      if (!history) continue;
      const turnCount = history.turns.length;
      const tokenEstimate = turnCount * TOKENS_PER_TURN_ESTIMATE;
      sessions.push(this.toSessionInfo(record, turnCount));
      estimatedTokens += tokenEstimate;
    }

    return { sessions, estimatedTokens };
  }

  async buildContext(query: ContextQuery, options?: ContextOptions): Promise<ContextResult> {
    if (!this.isSupportedType(query.type)) {
      return { ...EMPTY_RESULT };
    }

    const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
    const candidates = await this.resolveCandidates(query, options?.limit);

    // Load histories for sessions that have files
    type LoadedSession = {
      record: SessionRecord;
      history: import("./types.js").SessionHistory;
    };

    const loaded: LoadedSession[] = [];
    for (const record of candidates) {
      const history = await this.store.read(record.sessionId);
      if (history) {
        loaded.push({ record, history });
      }
    }

    if (loaded.length === 0) {
      return { ...EMPTY_RESULT };
    }

    const totalTurns = loaded.reduce((sum, s) => sum + s.history.turns.length, 0);

    // Auto-select mode based on total turn count
    let mode: ContextMode = selectLevel(totalTurns);

    // Build markdown with selected mode
    let markdown = this.buildMergedMarkdown(loaded, mode, query);
    let tokenEstimate = estimateTokens(markdown);

    // Downgrade to compact if over budget
    if (tokenEstimate > maxTokens && mode !== "compact") {
      mode = "compact";
      markdown = this.buildMergedMarkdown(loaded, mode, query);
      tokenEstimate = estimateTokens(markdown);
    }

    // Truncate oldest sessions if still over budget
    let truncated = false;
    let activeSessions = [...loaded];
    while (tokenEstimate > maxTokens && activeSessions.length > 1) {
      // Remove the oldest session (last in list, sorted newest-first)
      activeSessions = activeSessions.slice(0, activeSessions.length - 1);
      markdown = this.buildMergedMarkdown(activeSessions, mode, query);
      tokenEstimate = estimateTokens(markdown);
      truncated = true;
    }

    const timeRange = this.computeTimeRange(activeSessions.map((s) => s.record));

    return {
      markdown,
      tokenEstimate,
      sessionCount: activeSessions.length,
      totalTurns: activeSessions.reduce((sum, s) => sum + s.history.turns.length, 0),
      mode,
      truncated,
      timeRange,
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private isSupportedType(type: ContextQuery["type"]): boolean {
    return type === "session" || type === "latest";
  }

  private async resolveCandidates(query: ContextQuery, limit?: number): Promise<SessionRecord[]> {
    const all = this.getSessionRecords();

    if (query.type === "session") {
      const found = all.find((r) => r.sessionId === query.value);
      return found ? [found] : [];
    }

    // latest: sort by lastActiveAt descending, take N
    const n = limit ?? (parseInt(query.value, 10) || 5);
    const sorted = [...all].sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );
    return sorted.slice(0, n);
  }

  private toSessionInfo(record: SessionRecord, turnCount: number): SessionInfo {
    return {
      checkpointId: "",
      sessionIndex: "",
      transcriptPath: "",
      createdAt: record.createdAt,
      endedAt: record.lastActiveAt,
      branch: "",
      agent: record.agentName,
      turnCount,
      filesTouched: [],
      sessionId: record.sessionId,
    };
  }

  private buildMergedMarkdown(
    sessions: Array<{ record: SessionRecord; history: import("./types.js").SessionHistory }>,
    mode: ContextMode,
    query: ContextQuery
  ): string {
    if (sessions.length === 0) return "";

    const totalTurns = sessions.reduce((sum, s) => sum + s.history.turns.length, 0);
    const title = query.type === "session" ? query.value : `latest ${sessions.length} sessions`;

    const parts: string[] = [];
    parts.push(`# Conversation History — ${title}`);
    parts.push(`${sessions.length} sessions | ${totalTurns} turns | mode: ${mode}`);
    parts.push("");

    for (let i = 0; i < sessions.length; i++) {
      const { record, history } = sessions[i];
      const sessionMd = buildHistoryMarkdown(history.turns, mode);

      parts.push(`## Session ${i + 1} — ${record.agentName} · ${record.sessionId} (${history.turns.length} turns)`);
      parts.push("");
      if (sessionMd) {
        parts.push(sessionMd);
      }
    }

    parts.push(
      "> **Note:** This conversation history may contain outdated information. Verify current state before acting on past context."
    );

    return parts.join("\n");
  }

  private computeTimeRange(
    records: SessionRecord[]
  ): { start: string; end: string } {
    if (records.length === 0) return { start: "", end: "" };

    const dates = records.map((r) => r.createdAt).filter(Boolean);
    const ends = records.map((r) => r.lastActiveAt).filter(Boolean);

    const start = dates.sort()[0] ?? "";
    const end = ends.sort().reverse()[0] ?? "";

    return { start, end };
  }
}
