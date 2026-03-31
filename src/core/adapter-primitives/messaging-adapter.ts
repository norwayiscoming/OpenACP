import type {
  IChannelAdapter,
  ChannelConfig,
  AdapterCapabilities,
} from "../channel.js";
import type {
  OutgoingMessage,
  PermissionRequest,
  NotificationMessage,
} from "../types.js";
import type { DisplayVerbosity, ToolCallMeta } from "./format-types.js";
import type { IRenderer } from "./rendering/renderer.js";
import { evaluateNoise } from "./message-formatter.js";

export interface AdapterContext {
  configManager: { get(): Record<string, unknown> };
  fileService?: unknown;
}

export interface MessagingAdapterConfig extends ChannelConfig {
  maxMessageLength: number;
  flushInterval?: number;
  sendInterval?: number;
  thinkingRefreshInterval?: number;
  thinkingDuration?: number;
  displayVerbosity?: DisplayVerbosity;
}

export interface SentMessage {
  messageId: string;
}

const HIDDEN_ON_LOW = new Set(["thought", "usage"]);

export abstract class MessagingAdapter implements IChannelAdapter {
  abstract readonly name: string;
  abstract readonly renderer: IRenderer;
  abstract readonly capabilities: AdapterCapabilities;

  constructor(
    protected context: AdapterContext,
    protected adapterConfig: MessagingAdapterConfig,
  ) {}

  // === Message dispatch flow ===

  async sendMessage(
    sessionId: string,
    content: OutgoingMessage,
  ): Promise<void> {
    const verbosity = this.getVerbosity();
    if (!this.shouldDisplay(content, verbosity)) return;
    await this.dispatchMessage(sessionId, content, verbosity);
  }

  protected async dispatchMessage(
    sessionId: string,
    content: OutgoingMessage,
    verbosity: DisplayVerbosity,
  ): Promise<void> {
    switch (content.type) {
      case "text":
        return this.handleText(sessionId, content);
      case "thought":
        return this.handleThought(sessionId, content, verbosity);
      case "tool_call":
        return this.handleToolCall(sessionId, content, verbosity);
      case "tool_update":
        return this.handleToolUpdate(sessionId, content, verbosity);
      case "plan":
        return this.handlePlan(sessionId, content, verbosity);
      case "usage":
        return this.handleUsage(sessionId, content, verbosity);
      case "error":
        return this.handleError(sessionId, content);
      case "attachment":
        return this.handleAttachment(sessionId, content);
      case "system_message":
        return this.handleSystem(sessionId, content);
      case "session_end":
        return this.handleSessionEnd(sessionId, content);
      case "mode_change":
        return this.handleModeChange(sessionId, content);
      case "config_update":
        return this.handleConfigUpdate(sessionId, content);
      case "model_update":
        return this.handleModelUpdate(sessionId, content);
      case "user_replay":
        return this.handleUserReplay(sessionId, content);
      case "resource":
        return this.handleResource(sessionId, content);
      case "resource_link":
        return this.handleResourceLink(sessionId, content);
    }
  }

  // === Default handlers — all protected, all overridable ===

  protected async handleText(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}
  protected async handleThought(
    _sessionId: string,
    _content: OutgoingMessage,
    _verbosity: DisplayVerbosity,
  ): Promise<void> {}
  protected async handleToolCall(
    _sessionId: string,
    _content: OutgoingMessage,
    _verbosity: DisplayVerbosity,
  ): Promise<void> {}
  protected async handleToolUpdate(
    _sessionId: string,
    _content: OutgoingMessage,
    _verbosity: DisplayVerbosity,
  ): Promise<void> {}
  protected async handlePlan(
    _sessionId: string,
    _content: OutgoingMessage,
    _verbosity: DisplayVerbosity,
  ): Promise<void> {}
  protected async handleUsage(
    _sessionId: string,
    _content: OutgoingMessage,
    _verbosity: DisplayVerbosity,
  ): Promise<void> {}
  protected async handleError(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}
  protected async handleAttachment(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}
  protected async handleSystem(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}
  protected async handleSessionEnd(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}
  protected async handleModeChange(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}
  protected async handleConfigUpdate(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}
  protected async handleModelUpdate(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}
  protected async handleUserReplay(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}
  protected async handleResource(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}
  protected async handleResourceLink(
    _sessionId: string,
    _content: OutgoingMessage,
  ): Promise<void> {}

  // === Helpers ===

  protected getVerbosity(): DisplayVerbosity {
    const config = this.context.configManager.get();
    const channelConfig = (config as Record<string, unknown>).channels as
      | Record<string, Record<string, unknown>>
      | undefined;
    const ch = channelConfig?.[this.name];
    const v =
      ch?.outputMode ??
      ch?.displayVerbosity ??
      (config as Record<string, unknown>).outputMode ??
      this.adapterConfig.displayVerbosity;
    if (v === "low" || v === "high") return v;
    return "medium";
  }

  protected shouldDisplay(
    content: OutgoingMessage,
    verbosity: DisplayVerbosity,
  ): boolean {
    if (verbosity === "low" && HIDDEN_ON_LOW.has(content.type)) return false;

    if (content.type === "tool_call") {
      const meta = (content.metadata ?? {}) as Partial<ToolCallMeta>;
      const toolName = meta.name ?? content.text ?? "";
      const toolKind = String(meta.kind ?? "other");
      const noiseAction = evaluateNoise(toolName, toolKind, meta.rawInput);
      if (noiseAction === "hide" && verbosity !== "high") return false;
      if (noiseAction === "collapse" && verbosity === "low") return false;
    }

    return true;
  }

  // === Abstract — adapter MUST implement ===

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract createSessionThread(
    sessionId: string,
    name: string,
  ): Promise<string>;
  abstract renameSessionThread(
    sessionId: string,
    newName: string,
  ): Promise<void>;
  abstract sendPermissionRequest(
    sessionId: string,
    request: PermissionRequest,
  ): Promise<void>;
  abstract sendNotification(notification: NotificationMessage): Promise<void>;
}
