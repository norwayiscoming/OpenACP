import { nanoid } from "nanoid";
import type { AgentInstance } from "../agents/agent-instance.js";
import type { AgentCapabilities, AgentCommand, AgentEvent, AgentSwitchEntry, Attachment, PermissionRequest, SessionStatus, ConfigOption, SessionModeState, SessionModelState } from "../types.js";
import { TypedEmitter } from "../utils/typed-emitter.js";
import { PromptQueue } from "./prompt-queue.js";
import { PermissionGate } from "./permission-gate.js";
import { createChildLogger, createSessionLogger, closeSessionLogger, type Logger } from "../utils/log.js";
import type { SpeechService } from "../../plugins/speech/exports.js";
import type { MiddlewareChain } from "../plugin/middleware-chain.js";
import * as fs from "node:fs";
import type { TurnRouting } from "./turn-context.js";
import { createTurnContext, type TurnContext } from "./turn-context.js";
const moduleLog = createChildLogger({ module: "session" });

// TTS constants
export const TTS_PROMPT_INSTRUCTION = `\n\nAdditionally, include a [TTS]...[/TTS] block with a spoken-friendly summary of your response. Focus on key information, decisions the user needs to make, or actions required. The agent decides what to say and how long. Respond in the same language the user is using. This instruction applies to this message only.`;
export const TTS_BLOCK_REGEX = /\[TTS\]([\s\S]*?)\[\/TTS\]/;
export const TTS_MAX_LENGTH = 5000;
export const TTS_TIMEOUT_MS = 30_000;

// Valid state transitions: from → Set<to>
const VALID_TRANSITIONS: Record<SessionStatus, Set<SessionStatus>> = {
  initializing: new Set(["active", "error"]),
  active: new Set(["error", "finished", "cancelled"]),
  error: new Set(["active", "cancelled"]),
  cancelled: new Set(["active"]),
  finished: new Set(),
};

export interface SessionEvents {
  agent_event: (event: AgentEvent) => void;
  permission_request: (request: PermissionRequest) => void;
  session_end: (reason: string) => void;
  status_change: (from: SessionStatus, to: SessionStatus) => void;
  named: (name: string) => void;
  error: (error: Error) => void;
  prompt_count_changed: (count: number) => void;
  turn_started: (ctx: TurnContext) => void;
}

export class Session extends TypedEmitter<SessionEvents> {
  id: string;
  channelId: string;
  /** @deprecated Use threadIds map directly. Getter returns primary adapter's threadId. */
  get threadId(): string {
    return this.threadIds.get(this.channelId) ?? "";
  }
  set threadId(value: string) {
    if (value) {
      this.threadIds.set(this.channelId, value);
    }
  }
  agentName: string;
  workingDirectory: string;
  agentInstance: AgentInstance;
  agentSessionId: string = "";
  private _status: SessionStatus = "initializing";
  name?: string;
  createdAt: Date = new Date();
  voiceMode: "off" | "next" | "on" = "off";
  configOptions: ConfigOption[] = [];
  clientOverrides: { bypassPermissions?: boolean } = {};
  agentCapabilities?: AgentCapabilities;
  archiving: boolean = false;
  promptCount: number = 0;
  firstAgent: string;
  agentSwitchHistory: AgentSwitchEntry[] = [];
  isAssistant: boolean = false;
  log: Logger;
  middlewareChain?: MiddlewareChain;
  /** Latest commands emitted by the agent — buffered before bridge connects so they're not lost */
  latestCommands: AgentCommand[] | null = null;
  /** Adapters currently attached to this session (including primary) */
  attachedAdapters: string[] = [];
  /** Per-adapter thread IDs: adapterId → threadId */
  threadIds: Map<string, string> = new Map();
  /** Active turn context — sealed on prompt dequeue, cleared on turn end */
  activeTurnContext: TurnContext | null = null;
  /** The agentInstance for which the agent→session event relay is wired (prevents duplicate relays from multiple bridges).
   *  When the agent is swapped, the relay must be re-wired to the new instance. */
  agentRelaySource: AgentInstance | null = null;

  readonly permissionGate = new PermissionGate();
  private readonly queue: PromptQueue;
  private speechService?: SpeechService;
  private pendingContext: string | null = null;

  constructor(opts: {
    id?: string;
    channelId: string;
    agentName: string;
    workingDirectory: string;
    agentInstance: AgentInstance;
    speechService?: SpeechService;
    isAssistant?: boolean;
  }) {
    super();
    this.id = opts.id || nanoid(12);
    this.channelId = opts.channelId;
    this.attachedAdapters = [opts.channelId];
    this.agentName = opts.agentName;
    this.firstAgent = opts.agentName;
    this.workingDirectory = opts.workingDirectory;
    this.agentInstance = opts.agentInstance;
    this.speechService = opts.speechService;
    this.isAssistant = opts.isAssistant ?? false;
    this.log = createSessionLogger(this.id, moduleLog);
    this.log.info({ agentName: this.agentName }, "Session created");

    this.queue = new PromptQueue(
      (text, attachments, routing, turnId) => this.processPrompt(text, attachments, routing, turnId),
      (err) => {
        this.log.error({ err }, "Prompt execution failed");
        const message = err instanceof Error ? err.message : String(err);
        this.fail(message);
        this.emit("agent_event", { type: "error", message: `Prompt execution failed: ${message}` });
      },
    );

    this.wireCommandsBuffer();
  }

  /** Wire a listener on the current agentInstance to buffer commands_update events.
   *  Must be called after every agentInstance replacement (constructor + switchAgent). */
  private commandsBufferCleanup?: () => void;
  private wireCommandsBuffer(): void {
    // Remove previous listener (if switching agents) to avoid leaks
    this.commandsBufferCleanup?.();
    const handler = (event: AgentEvent) => {
      if (event.type === "commands_update") {
        this.latestCommands = event.commands;
      }
    };
    this.agentInstance.on("agent_event", handler);
    this.commandsBufferCleanup = () => this.agentInstance.off("agent_event", handler);
  }

  // --- State Machine ---

  get status(): SessionStatus {
    return this._status;
  }


  /** Transition to active — from initializing, error, or cancelled */
  activate(): void {
    this.transition("active");
  }

  /** Transition to error — from initializing or active. Idempotent if already in error. */
  fail(reason: string): void {
    if (this._status === "error") return;
    this.transition("error");
    this.emit("error", new Error(reason));
  }

  /** Transition to finished — from active only. Emits session_end for backward compat. */
  finish(reason?: string): void {
    this.transition("finished");
    this.emit("session_end", reason ?? "completed");
  }

  /** Transition to cancelled — from active only (terminal session cancel) */
  markCancelled(): void {
    this.transition("cancelled");
  }

  private transition(to: SessionStatus): void {
    const from = this._status;
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed?.has(to)) {
      throw new Error(
        `Invalid session transition: ${from} → ${to}`,
      );
    }
    this._status = to;
    this.log.debug({ from, to }, "Session status transition");
    this.emit("status_change", from, to);
  }

  /** Number of prompts waiting in queue */
  get queueDepth(): number {
    return this.queue.pending;
  }

  get promptRunning(): boolean {
    return this.queue.isProcessing;
  }

  // --- Context Injection ---

  setContext(markdown: string): void {
    this.pendingContext = markdown;
  }

  // --- Voice Mode ---

  setVoiceMode(mode: "off" | "next" | "on"): void {
    this.voiceMode = mode;
    this.log.info({ voiceMode: mode }, "TTS mode changed");
  }

  // --- Public API ---

  async enqueuePrompt(text: string, attachments?: Attachment[], routing?: TurnRouting, externalTurnId?: string): Promise<string> {
    // Use pre-generated turnId if provided (so callers can emit events before awaiting the queue)
    const turnId = externalTurnId ?? nanoid(8);
    // Hook: agent:beforePrompt — modifiable, can block
    if (this.middlewareChain) {
      const payload = { text, attachments, sessionId: this.id };
      const result = await this.middlewareChain.execute('agent:beforePrompt', payload, async (p) => p);
      if (!result) return turnId; // blocked by middleware
      text = result.text;
      attachments = result.attachments;
    }
    await this.queue.enqueue(text, attachments, routing, turnId);
    return turnId;
  }

  private async processPrompt(text: string, attachments?: Attachment[], routing?: TurnRouting, turnId?: string): Promise<void> {
    // Don't process prompts for finished sessions (queue may still drain)
    if (this._status === "finished") return;

    // Seal turn context — bridges use this to decide routing for every emitted event
    // Pass the pre-generated turnId so message:queued and message:processing share the same ID
    this.activeTurnContext = createTurnContext(
      routing?.sourceAdapterId ?? this.channelId,
      routing?.responseAdapterId,
      turnId,
    );

    // Emit turn_started so SessionBridge can emit message:processing on EventBus
    this.emit("turn_started", this.activeTurnContext);

    this.promptCount++;
    this.emit('prompt_count_changed', this.promptCount);

    if (this._status === "initializing" || this._status === "cancelled" || this._status === "error") {
      this.activate();
    }
    const promptStart = Date.now();
    this.log.debug("Prompt execution started");

    // Context injection: prepend on first real prompt only
    const contextUsed = this.pendingContext;
    if (contextUsed) {
      text = `[CONVERSATION HISTORY - This is context from previous sessions, not current conversation]\n\n${contextUsed}\n\n[END CONVERSATION HISTORY]\n\n${text}`;
      this.log.debug("Context injected into prompt");
    }

    // STT: transcribe audio attachments if agent doesn't support audio
    const processed = await this.maybeTranscribeAudio(text, attachments);

    // TTS: determine if TTS is active for this prompt
    const ttsActive =
      this.voiceMode !== "off" &&
      !!this.speechService?.isTTSAvailable();

    // TTS: inject prompt instruction
    if (ttsActive) {
      processed.text += TTS_PROMPT_INSTRUCTION;
    }

    // TTS: set up text accumulator before prompting
    let accumulatedText = "";
    const accumulatorListener = ttsActive
      ? (event: AgentEvent) => {
          if (event.type === "text") {
            accumulatedText += event.content;
          }
        }
      : null;

    if (accumulatorListener) {
      this.on("agent_event", accumulatorListener);
    }

    // Hook: turn:start — read-only, fire-and-forget
    if (this.middlewareChain) {
      this.middlewareChain.execute('turn:start', { sessionId: this.id, promptText: processed.text, promptNumber: this.promptCount }, async (p) => p).catch(() => {});
    }

    let stopReason: string = 'end_turn';
    let promptError: unknown;
    try {
      const response = await this.agentInstance.prompt(processed.text, processed.attachments);
      if (response && typeof response === 'object' && 'stopReason' in response) {
        stopReason = (response as { stopReason?: string }).stopReason ?? 'end_turn';
      }
      // Clear context only after successful prompt — if prompt fails, context is preserved for retry
      if (contextUsed) {
        this.pendingContext = null;
      }
      // Reset "next" voice mode only after successful prompt
      if (ttsActive && this.voiceMode === "next") {
        this.voiceMode = "off";
      }
    } catch (err) {
      stopReason = 'error';
      promptError = err;
    } finally {
      if (accumulatorListener) {
        this.off("agent_event", accumulatorListener);
      }
      // Hook: turn:end — always fires, even on error
      if (this.middlewareChain) {
        this.middlewareChain.execute('turn:end', { sessionId: this.id, stopReason: stopReason as import('../types.js').StopReason, durationMs: Date.now() - promptStart }, async (p) => p).catch(() => {});
      }
      // Always clear turn context so routing state is never stale after a failed turn
      this.activeTurnContext = null;
    }

    // Re-throw so PromptQueue error handler can call this.fail()
    if (promptError !== undefined) {
      throw promptError;
    }

    this.log.info(
      { durationMs: Date.now() - promptStart },
      "Prompt execution completed",
    );

    // TTS: fire-and-forget post-response synthesis
    if (ttsActive && accumulatedText) {
      this.processTTSResponse(accumulatedText).catch((err) => {
        this.log.warn({ err }, "TTS post-processing failed");
      });
    }

    if (!this.name) {
      await this.autoName();
    }
  }

  private async maybeTranscribeAudio(
    text: string,
    attachments?: Attachment[],
  ): Promise<{ text: string; attachments?: Attachment[] }> {
    if (!attachments?.length || !this.speechService) {
      return { text, attachments };
    }

    const hasAudioCapability = this.agentInstance.promptCapabilities?.audio === true;
    if (hasAudioCapability) {
      return { text, attachments };
    }

    if (!this.speechService.isSTTAvailable()) {
      return { text, attachments };
    }

    let transcribedText = text;
    const remainingAttachments: Attachment[] = [];

    for (const att of attachments) {
      if (att.type !== "audio") {
        remainingAttachments.push(att);
        continue;
      }

      try {
        const audioPath = att.originalFilePath || att.filePath;
        const audioMime = att.originalFilePath ? "audio/ogg" : att.mimeType;
        const audioBuffer = await fs.promises.readFile(audioPath);
        const result = await this.speechService.transcribe(audioBuffer, audioMime);
        this.log.info({ provider: "stt", duration: result.duration }, "Voice transcribed");
        // Notify user of transcription result
        this.emit("agent_event", {
          type: "system_message",
          message: `🎤 You said: ${result.text}`,
        });
        // Strip [Audio: ...] placeholder since we have the transcription
        transcribedText = transcribedText.replace(/\[Audio:\s*[^\]]*\]\s*/g, "").trim();
        transcribedText = transcribedText
          ? `${transcribedText}\n${result.text}`
          : result.text;
      } catch (err) {
        this.log.warn({ err }, "STT transcription failed, keeping audio attachment");
        this.emit("agent_event", {
          type: "error",
          message: `Voice transcription failed: ${(err as Error).message}`,
        });
        remainingAttachments.push(att);
      }
    }

    return {
      text: transcribedText,
      attachments: remainingAttachments.length > 0 ? remainingAttachments : undefined,
    };
  }

  private async processTTSResponse(responseText: string): Promise<void> {
    const match = TTS_BLOCK_REGEX.exec(responseText);
    if (!match?.[1]) {
      this.log.debug("No [TTS] block found in response, skipping synthesis");
      return;
    }

    let ttsText = match[1].trim();
    if (!ttsText) return;

    if (ttsText.length > TTS_MAX_LENGTH) {
      ttsText = ttsText.slice(0, TTS_MAX_LENGTH);
    }

    try {
      let ttsTimer: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        ttsTimer = setTimeout(() => reject(new Error("TTS synthesis timed out")), TTS_TIMEOUT_MS);
      });
      try {
        const result = await Promise.race([
          this.speechService!.synthesize(ttsText),
          timeoutPromise,
        ]);
        const base64 = result.audioBuffer.toString("base64");
        this.emit("agent_event", {
          type: "audio_content",
          data: base64,
          mimeType: result.mimeType,
        });
        this.emit("agent_event", { type: "tts_strip" });
        this.log.info("TTS synthesis completed");
      } finally {
        clearTimeout(ttsTimer!);
      }
    } catch (err) {
      this.log.warn({ err }, "TTS synthesis failed, skipping");
    }
  }

  // NOTE: This injects a summary prompt into the agent's conversation history.
  private async autoName(): Promise<void> {
    let title = "";

    // Temporarily remove all agent_event listeners so auto-name output
    // is not forwarded to the adapter. Add a capture-only listener instead.
    const captureHandler = (event: AgentEvent) => {
      if (event.type === "text") title += event.content;
      // Swallow all other events from auto-name prompt
    };

    // Pause the session emitter so agent_event emissions from SessionBridge
    // don't reach the adapter during auto-name. The AgentInstance emitter
    // stays active — we just intercept with our capture handler.
    this.pause((event) => event !== "agent_event");
    this.agentInstance.on("agent_event", captureHandler);

    try {
      await this.agentInstance.prompt(
        "Summarize this conversation in max 5 words for a topic title. Reply ONLY with the title, nothing else.",
      );
      this.name = title.trim().slice(0, 50) || `Session ${this.id.slice(0, 6)}`;
      this.log.info({ name: this.name }, "Session auto-named");

      // Emit named event — SessionBridge listens to rename the thread
      this.emit("named", this.name);
    } catch {
      this.name = `Session ${this.id.slice(0, 6)}`;
    } finally {
      this.agentInstance.off("agent_event", captureHandler);
      // Discard buffered auto-name agent_events, then resume normal delivery
      this.clearBuffer();
      this.resume();
    }
  }


  // --- ACP Mode / Config / Model State ---

  setInitialConfigOptions(options: ConfigOption[]): void {
    this.configOptions = options ?? [];
  }

  setAgentCapabilities(caps: AgentCapabilities | undefined): void {
    this.agentCapabilities = caps;
  }

  /**
   * Hydrate configOptions and agentCapabilities from a spawn response.
   * Handles both the native configOptions format and legacy modes/models fields.
   */
  applySpawnResponse(resp: { modes?: unknown; configOptions?: unknown; models?: unknown } | undefined, caps: AgentCapabilities | undefined): void {
    if (caps) this.agentCapabilities = caps;
    if (!resp) return;

    if (resp.configOptions) {
      this.configOptions = resp.configOptions as ConfigOption[];
      return;
    }

    // Convert legacy modes/models fields (old ACP format) to configOptions
    const legacyOptions: ConfigOption[] = [];
    if (resp.modes) {
      const m = resp.modes as SessionModeState;
      legacyOptions.push({
        id: 'mode', name: 'Mode', category: 'mode', type: 'select',
        currentValue: m.currentModeId,
        options: m.availableModes.map(x => ({ value: x.id, name: x.name, description: x.description })),
      });
    }
    if (resp.models) {
      const m = resp.models as SessionModelState;
      legacyOptions.push({
        id: 'model', name: 'Model', category: 'model', type: 'select',
        currentValue: m.currentModelId,
        options: m.availableModels.map(x => ({ value: (x as any).modelId ?? x.id, name: x.name, description: x.description })),
      });
    }
    if (legacyOptions.length > 0) this.configOptions = legacyOptions;
  }

  getConfigOption(id: string): ConfigOption | undefined {
    return this.configOptions.find(o => o.id === id);
  }

  getConfigByCategory(category: string): ConfigOption | undefined {
    return this.configOptions.find(o => o.category === category);
  }

  getConfigValue(id: string): string | undefined {
    const option = this.getConfigOption(id);
    if (!option) return undefined;
    return String(option.currentValue);
  }

  /** Set session name explicitly and emit 'named' event */
  setName(name: string): void {
    this.name = name;
    this.emit("named", name);
  }

  /** Send a config option change to the agent and update local state from the response. */
  async setConfigOption(configId: string, value: import("../types.js").SetConfigOptionValue): Promise<void> {
    const response = await this.agentInstance.setConfigOption(configId, value);
    if (response.configOptions && response.configOptions.length > 0) {
      await this.updateConfigOptions(response.configOptions as ConfigOption[]);
    } else if (value.type === 'select') {
      // Legacy agents return empty configOptions — update currentValue optimistically.
      const updated = this.configOptions.map((o): ConfigOption =>
        o.id === configId && o.type === 'select' ? { ...o, currentValue: value.value as string } : o
      );
      await this.updateConfigOptions(updated);
    }
  }

  async updateConfigOptions(options: ConfigOption[]): Promise<void> {
    // Hook: config:beforeChange — await-able, can block
    if (this.middlewareChain) {
      const result = await this.middlewareChain.execute('config:beforeChange', { sessionId: this.id, configId: 'options', oldValue: this.configOptions, newValue: options }, async (p) => p);
      if (!result) return; // blocked by middleware
    }
    this.configOptions = options;
  }

  /** Snapshot of current ACP state for persistence */
  toAcpStateSnapshot(): NonNullable<import("../types.js").SessionRecord["acpState"]> {
    return {
      configOptions: this.configOptions.length > 0 ? this.configOptions : undefined,
      agentCapabilities: this.agentCapabilities,
    };
  }

  /** Check if the agent supports a specific session capability */
  supportsCapability(cap: 'list' | 'fork' | 'close' | 'loadSession'): boolean {
    if (cap === 'loadSession') return this.agentCapabilities?.loadSession === true;
    return this.agentCapabilities?.sessionCapabilities?.[cap] === true;
  }

  /** Cancel the current prompt and clear the queue. Stays in active state. */
  async abortPrompt(): Promise<void> {
    // Hook: agent:beforeCancel — modifiable, can block
    if (this.middlewareChain) {
      const result = await this.middlewareChain.execute('agent:beforeCancel', { sessionId: this.id }, async (p) => p);
      if (!result) return; // blocked by middleware
    }
    this.queue.clear();
    this.log.info("Prompt aborted");
    await this.agentInstance.cancel();
  }

  /** Search backward through agentSwitchHistory for the last entry matching agentName */
  findLastSwitchEntry(agentName: string): AgentSwitchEntry | undefined {
    for (let i = this.agentSwitchHistory.length - 1; i >= 0; i--) {
      if (this.agentSwitchHistory[i].agentName === agentName) {
        return this.agentSwitchHistory[i];
      }
    }
    return undefined;
  }

  /** Switch the agent instance in-place, preserving session identity */
  async switchAgent(agentName: string, createAgent: () => Promise<AgentInstance>): Promise<void> {
    if (agentName === this.agentName) {
      throw new Error(`Already using ${agentName}`);
    }

    // Record current agent in history
    this.agentSwitchHistory.push({
      agentName: this.agentName,
      agentSessionId: this.agentSessionId,
      switchedAt: new Date().toISOString(),
      promptCount: this.promptCount,
    });

    // Clear queued prompts and abort in-flight prompt before destroying old agent
    this.queue.clear();

    // Reject any pending permission request before destroying old agent
    if (this.permissionGate.isPending) {
      this.permissionGate.reject("Agent switched");
    }

    // Destroy old agent
    await this.agentInstance.destroy();

    // Create and wire new agent
    const newAgent = await createAgent();
    this.agentInstance = newAgent;
    this.agentName = agentName;
    this.agentSessionId = newAgent.sessionId;
    this.promptCount = 0;

    // Hydrate ACP state from the new agent's spawn response
    this.agentCapabilities = undefined;
    this.configOptions = [];
    this.latestCommands = null;
    this.applySpawnResponse(newAgent.initialSessionResponse, newAgent.agentCapabilities);
    this.wireCommandsBuffer();

    this.log.info({ from: this.agentSwitchHistory.at(-1)!.agentName, to: agentName }, "Agent switched");
  }

  async destroy(): Promise<void> {
    this.log.info("Session destroyed");
    // Reject any pending permission promise so callers don't hang
    if (this.permissionGate.isPending) {
      this.permissionGate.reject("Session destroyed");
    }
    // Clear queued prompts
    this.queue.clear();
    await this.agentInstance.destroy();
    closeSessionLogger(this.log);
  }
}
