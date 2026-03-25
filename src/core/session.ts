import { nanoid } from "nanoid";
import type { AgentInstance } from "./agent-instance.js";
import type { AgentEvent, Attachment, PermissionRequest, SessionStatus } from "./types.js";
import { TypedEmitter } from "./typed-emitter.js";
import { PromptQueue } from "./prompt-queue.js";
import { PermissionGate } from "./permission-gate.js";
import { createChildLogger, createSessionLogger, type Logger } from "./log.js";
import type { SpeechService } from "./speech/index.js";
import * as fs from "node:fs";
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
  error: new Set(["active"]),
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
}

export class Session extends TypedEmitter<SessionEvents> {
  id: string;
  channelId: string;
  threadId: string = "";
  agentName: string;
  workingDirectory: string;
  agentInstance: AgentInstance;
  agentSessionId: string = "";
  private _status: SessionStatus = "initializing";
  name?: string;
  createdAt: Date = new Date();
  voiceMode: "off" | "next" | "on" = "off";
  dangerousMode: boolean = false;
  archiving: boolean = false;
  log: Logger;

  readonly permissionGate = new PermissionGate();
  private readonly queue: PromptQueue;
  private speechService?: SpeechService;

  constructor(opts: {
    id?: string;
    channelId: string;
    agentName: string;
    workingDirectory: string;
    agentInstance: AgentInstance;
    speechService?: SpeechService;
  }) {
    super();
    this.id = opts.id || nanoid(12);
    this.channelId = opts.channelId;
    this.agentName = opts.agentName;
    this.workingDirectory = opts.workingDirectory;
    this.agentInstance = opts.agentInstance;
    this.speechService = opts.speechService;
    this.log = createSessionLogger(this.id, moduleLog);
    this.log.info({ agentName: this.agentName }, "Session created");

    this.queue = new PromptQueue(
      (text, attachments) => this.processPrompt(text, attachments),
      (err) => {
        this.fail("Prompt execution failed");
        this.log.error({ err }, "Prompt execution failed");
      },
    );
  }

  // --- State Machine ---

  get status(): SessionStatus {
    return this._status;
  }


  /** Transition to active — from initializing, error, or cancelled */
  activate(): void {
    this.transition("active");
  }

  /** Transition to error — from initializing or active */
  fail(reason: string): void {
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

  // --- Voice Mode ---

  setVoiceMode(mode: "off" | "next" | "on"): void {
    this.voiceMode = mode;
    this.log.info({ voiceMode: mode }, "TTS mode changed");
  }

  // --- Public API ---

  async enqueuePrompt(text: string, attachments?: Attachment[]): Promise<void> {
    await this.queue.enqueue(text, attachments);
  }

  private async processPrompt(text: string, attachments?: Attachment[]): Promise<void> {
    if (text === "\x00__warmup__") {
      await this.runWarmup();
      return;
    }

    if (this._status === "initializing") {
      this.activate();
    }
    const promptStart = Date.now();
    this.log.debug("Prompt execution started");

    // STT: transcribe audio attachments if agent doesn't support audio
    const processed = await this.maybeTranscribeAudio(text, attachments);

    // TTS: determine if TTS is active for this prompt
    const ttsActive =
      this.voiceMode !== "off" &&
      !!this.speechService?.isTTSAvailable();

    // TTS: inject prompt instruction
    if (ttsActive) {
      processed.text += TTS_PROMPT_INSTRUCTION;
      if (this.voiceMode === "next") {
        this.voiceMode = "off";
      }
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

    try {
      await this.agentInstance.prompt(processed.text, processed.attachments);
    } finally {
      if (accumulatorListener) {
        this.off("agent_event", accumulatorListener);
      }
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
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TTS synthesis timed out")), TTS_TIMEOUT_MS),
      );
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
      this.log.info("TTS synthesis completed");
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

  /** Fire-and-forget warm-up: primes model cache while user types their first message */
  async warmup(): Promise<void> {
    // Route through PromptQueue to prevent concurrent prompt execution.
    // Any user prompts arriving during warmup will be queued and drained after.
    await this.queue.enqueue("\x00__warmup__");
  }

  private async runWarmup(): Promise<void> {
    // Pause events but let commands_update pass through
    this.pause((_event, args) => {
      const agentEvent = args[0] as AgentEvent;
      return agentEvent?.type === "commands_update";
    });

    try {
      const start = Date.now();
      await this.agentInstance.prompt('Reply with only "ready".');
      this.activate();
      this.log.info({ durationMs: Date.now() - start }, "Warm-up complete");
    } catch (err) {
      this.log.error({ err }, "Warm-up failed");
    } finally {
      this.clearBuffer();
      this.resume();
    }
  }

  /** Cancel the current prompt and clear the queue. Stays in active state. */
  async abortPrompt(): Promise<void> {
    this.queue.clear();
    this.log.info("Prompt aborted");
    await this.agentInstance.cancel();
  }

  async destroy(): Promise<void> {
    this.log.info("Session destroyed");
    await this.agentInstance.destroy();
  }
}
