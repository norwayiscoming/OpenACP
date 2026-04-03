import type { Session } from "./session.js";
import type { IChannelAdapter } from "../channel.js";
import type { MessageTransformer } from "../message-transformer.js";
import type { NotificationManager } from "../../plugins/notifications/notification.js";
import type { SessionManager } from "./session-manager.js";
import type { AgentEvent, PermissionRequest, SessionStatus } from "../types.js";
import type { EventBus } from "../event-bus.js";
import type { FileServiceInterface } from "../plugin/types.js";
import type { MiddlewareChain } from "../plugin/middleware-chain.js";
import type { DebugTracer } from "../utils/debug-tracer.js";
import { createChildLogger } from "../utils/log.js";
import { isPermissionBypass } from "../utils/bypass-detection.js";

const log = createChildLogger({ module: "session-bridge" });

export interface BridgeDeps {
  messageTransformer: MessageTransformer;
  notificationManager: NotificationManager;
  sessionManager: SessionManager;
  eventBus?: EventBus;
  fileService?: FileServiceInterface;
  middlewareChain?: MiddlewareChain;
}

export class SessionBridge {
  private connected = false;
  private cleanupFns: Array<() => void> = [];

  constructor(
    private session: Session,
    private adapter: IChannelAdapter,
    private deps: BridgeDeps,
  ) {}

  private get tracer(): DebugTracer | null {
    return this.session.agentInstance.debugTracer ?? null;
  }

  /** Register a listener and track it for cleanup */
  private listen(emitter: any, event: string, handler: (...args: any[]) => void): void {
    emitter.on(event, handler);
    this.cleanupFns.push(() => emitter.off(event, handler));
  }

  /** Send message to adapter, optionally running through message:outgoing middleware */
  private async sendMessage(sessionId: string, message: ReturnType<MessageTransformer["transform"]>): Promise<void> {
    try {
      const mw = this.deps.middlewareChain;
      if (mw) {
        const result = await mw.execute('message:outgoing', { sessionId, message }, async (m) => m);
        this.tracer?.log("core", { step: "middleware:outgoing", sessionId, hook: "message:outgoing", blocked: !result });
        if (!result) return;
        this.tracer?.log("core", { step: "dispatch", sessionId, message: result.message });
        this.adapter.sendMessage(sessionId, result.message).catch((err) => {
          log.error({ err, sessionId }, "Failed to send message to adapter");
        });
      } else {
        this.tracer?.log("core", { step: "dispatch", sessionId, message });
        this.adapter.sendMessage(sessionId, message).catch((err) => {
          log.error({ err, sessionId }, "Failed to send message to adapter");
        });
      }
    } catch (err) {
      log.error({ err, sessionId }, "Error in sendMessage middleware");
    }
  }

  connect(): void {
    if (this.connected) return;
    this.connected = true;

    // Wire agent events to session (agent → session relay)
    this.listen(this.session.agentInstance, "agent_event", (event: AgentEvent) => {
      this.session.emit("agent_event", event);
    });

    // Wire session events to adapter (session → adapter dispatch)
    this.listen(this.session, "agent_event", (event: AgentEvent) => {
      this.dispatchAgentEvent(event);
    });

    // Wire permissions
    this.session.agentInstance.onPermissionRequest = async (request: PermissionRequest) => {
      return this.resolvePermission(request);
    };

    // Wire lifecycle: persist status changes and auto-disconnect on terminal states
    this.listen(this.session, "status_change", (from: SessionStatus, to: SessionStatus) => {
      this.deps.sessionManager.patchRecord(this.session.id, {
        status: to,
        lastActiveAt: new Date().toISOString(),
      });
      this.deps.eventBus?.emit("session:updated", {
        sessionId: this.session.id,
        status: to,
      });

      // Auto-disconnect on terminal states (finished only — cancelled sessions can resume)
      if (to === "finished") {
        // Disconnect on next tick so current event handlers can complete
        queueMicrotask(() => this.disconnect());
      }
    });

    // Wire lifecycle: persist and relay name changes — only rename thread once per session.
    this.listen(this.session, "named", async (name: string) => {
      const record = this.deps.sessionManager.getSessionRecord(this.session.id);
      const alreadyNamed = !!record?.name;
      await this.deps.sessionManager.patchRecord(this.session.id, { name });
      this.deps.eventBus?.emit("session:updated", {
        sessionId: this.session.id,
        name,
      });
      if (!alreadyNamed) {
        await this.adapter.renameSessionThread(this.session.id, name);
      }
    });

    // Wire lifecycle: persist prompt count after each prompt for resume decisions
    this.listen(this.session, "prompt_count_changed", (count: number) => {
      this.deps.sessionManager.patchRecord(this.session.id, { currentPromptCount: count });
    });

    // Replay any commands_update that arrived before the bridge connected
    if (this.session.latestCommands !== null) {
      this.session.emit("agent_event", { type: "commands_update", commands: this.session.latestCommands });
    }
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.session.agentInstance.onPermissionRequest = async () => "";
  }

  /** Dispatch an agent event through middleware and to the adapter */
  private async dispatchAgentEvent(event: AgentEvent): Promise<void> {
    this.tracer?.log("core", { step: "agent_event", sessionId: this.session.id, event });
    const mw = this.deps.middlewareChain;
    if (mw) {
      try {
        const result = await mw.execute('agent:beforeEvent', { sessionId: this.session.id, event }, async (e) => e);
        this.tracer?.log("core", { step: "middleware:before", sessionId: this.session.id, hook: "agent:beforeEvent", blocked: !result });
        if (!result) return; // blocked by middleware
        const transformedEvent = result.event;
        const outgoing = this.handleAgentEvent(transformedEvent);
        // Hook: agent:afterEvent — read-only, fire-and-forget
        mw.execute('agent:afterEvent', {
          sessionId: this.session.id,
          event: transformedEvent,
          outgoingMessage: outgoing ?? { type: 'text' as const, text: '' },
        }, async (e) => e).catch(() => {});
      } catch {
        // Middleware error — proceed with original event
        try {
          this.handleAgentEvent(event);
        } catch (err) {
          log.error({ err, sessionId: this.session.id }, "Error handling agent event (middleware fallback)");
        }
      }
    } else {
      try {
        this.handleAgentEvent(event);
      } catch (err) {
        log.error({ err, sessionId: this.session.id }, "Error handling agent event");
      }
    }
  }

  private handleAgentEvent(event: AgentEvent): import('../types.js').OutgoingMessage | undefined {
    const session = this.session;
    const ctx = {
      get id() {
        return session.id;
      },
      get workingDirectory() {
        return session.workingDirectory;
      },
    };

    let outgoing: import('../types.js').OutgoingMessage | undefined;

      switch (event.type) {
        case "text":
        case "thought":
        case "tool_call":
        case "tool_update":
        case "plan":
        case "usage":
          outgoing = this.deps.messageTransformer.transform(event, ctx);
          this.tracer?.log("core", { step: "transform", sessionId: this.session.id, input: event, output: outgoing });
          this.sendMessage(this.session.id, outgoing);
          break;

        case "session_end":
          this.session.finish(event.reason);
          this.adapter.cleanupSkillCommands?.(this.session.id);
          outgoing = this.deps.messageTransformer.transform(event);
          this.sendMessage(this.session.id, outgoing);
          this.deps.notificationManager.notify(this.session.channelId, {
            sessionId: this.session.id,
            sessionName: this.session.name,
            type: "completed",
            summary: `Session "${this.session.name || this.session.id}" completed\n⏱ ${Math.round((Date.now() - this.session.createdAt.getTime()) / 60000)} min · 💬 ${this.session.promptCount} prompts`,
          });
          break;

        case "error":
          this.session.fail(event.message);
          this.adapter.cleanupSkillCommands?.(this.session.id);
          outgoing = this.deps.messageTransformer.transform(event);
          this.sendMessage(this.session.id, outgoing);
          this.deps.notificationManager.notify(this.session.channelId, {
            sessionId: this.session.id,
            sessionName: this.session.name,
            type: "error",
            summary: event.message,
          });
          break;

        case "image_content": {
          if (this.deps.fileService) {
            const fs = this.deps.fileService;
            const sid = this.session.id;
            const { data, mimeType } = event;
            const buffer = Buffer.from(data, "base64");
            const ext = fs.extensionFromMime(mimeType);
            fs.saveFile(sid, `agent-image${ext}`, buffer, mimeType)
              .then((att) => {
                this.sendMessage(sid, {
                  type: "attachment",
                  text: "",
                  attachment: att,
                });
              })
              .catch((err) => log.error({ err }, "Failed to save agent image"));
          }
          break;
        }
        case "audio_content": {
          if (this.deps.fileService) {
            const fs = this.deps.fileService;
            const sid = this.session.id;
            const { data, mimeType } = event;
            const buffer = Buffer.from(data, "base64");
            const ext = fs.extensionFromMime(mimeType);
            fs.saveFile(sid, `agent-audio${ext}`, buffer, mimeType)
              .then((att) => {
                this.sendMessage(sid, {
                  type: "attachment",
                  text: "",
                  attachment: att,
                });
              })
              .catch((err) => log.error({ err }, "Failed to save agent audio"));
          }
          break;
        }

        case "commands_update":
          log.debug({ commands: event.commands }, "Commands available");
          this.adapter.sendSkillCommands?.(this.session.id, event.commands);
          break;

        case "system_message":
          outgoing = this.deps.messageTransformer.transform(event);
          this.sendMessage(this.session.id, outgoing);
          break;

        case "session_info_update":
          if (event.title) {
            this.session.setName(event.title);
          }
          outgoing = this.deps.messageTransformer.transform(event);
          this.sendMessage(this.session.id, outgoing);
          break;

        case "config_option_update":
          this.session.updateConfigOptions(event.options);
          this.persistAcpState();
          outgoing = this.deps.messageTransformer.transform(event);
          this.sendMessage(this.session.id, outgoing);
          break;

        case "user_message_chunk":
          outgoing = this.deps.messageTransformer.transform(event);
          this.sendMessage(this.session.id, outgoing);
          break;

        case "resource_content":
        case "resource_link":
          outgoing = this.deps.messageTransformer.transform(event);
          this.sendMessage(this.session.id, outgoing);
          break;

        case "tts_strip":
          this.adapter.stripTTSBlock?.(this.session.id);
          break;
      }

      this.deps.eventBus?.emit("agent:event", {
        sessionId: this.session.id,
        event,
      });

    return outgoing;
  }

  /** Persist current ACP state (configOptions, agentCapabilities) to session store as cache */
  private persistAcpState(): void {
    this.deps.sessionManager.patchRecord(this.session.id, {
      acpState: this.session.toAcpStateSnapshot(),
    });
  }

  /** Resolve a permission request through the full pipeline: middleware -> auto-approve -> ask user */
  private async resolvePermission(request: PermissionRequest): Promise<string> {
    const startTime = Date.now();
    const mw = this.deps.middlewareChain;

    // Step 1: Middleware
    let permReq = request;
    if (mw) {
      const payload = { sessionId: this.session.id, request, autoResolve: undefined as string | undefined };
      const result = await mw.execute('permission:beforeRequest', payload, async (r) => r);
      if (!result) return ""; // blocked by middleware
      permReq = result.request;
      // If middleware set autoResolve, skip UI and return directly
      if (result.autoResolve) {
        this.emitAfterResolve(mw, permReq.id, result.autoResolve, 'middleware', startTime);
        return result.autoResolve;
      }
    }

    this.session.emit("permission_request", permReq);
    this.deps.eventBus?.emit("permission:request", {
      sessionId: this.session.id,
      permission: permReq,
    });

    // Step 2: Auto-approve
    const autoDecision = this.checkAutoApprove(permReq);
    if (autoDecision) {
      this.emitAfterResolve(mw, permReq.id, autoDecision, 'system', startTime);
      return autoDecision;
    }

    // Step 3: Ask user
    // Set pending BEFORE sending UI to avoid race condition
    const promise = this.session.permissionGate.setPending(permReq);

    // Send permission UI to session topic
    await this.adapter.sendPermissionRequest(this.session.id, permReq);

    // Wait for user response — adapter resolves this promise
    const optionId = await promise;

    this.emitAfterResolve(mw, permReq.id, optionId, 'user', startTime);
    return optionId;
  }

  /** Check if a permission request should be auto-approved (bypass mode only) */
  private checkAutoApprove(request: PermissionRequest): string | null {
    // Bypass mode: auto-approve all permissions (agent-side or client-side)
    const modeOption = this.session.getConfigByCategory("mode");
    const isAgentBypass = modeOption && isPermissionBypass(
      typeof modeOption.currentValue === "string" ? modeOption.currentValue : ""
    );
    const isClientBypass = this.session.clientOverrides.bypassPermissions;
    if (isAgentBypass || isClientBypass) {
      const allowOption = request.options.find((o) => o.isAllow);
      if (allowOption) {
        log.info(
          { sessionId: this.session.id, requestId: request.id, optionId: allowOption.id, agentBypass: !!isAgentBypass, clientBypass: !!isClientBypass },
          "Bypass mode: auto-approving permission",
        );
        return allowOption.id;
      }
    }

    return null;
  }

  /** Emit permission:afterResolve middleware hook (fire-and-forget) */
  private emitAfterResolve(mw: MiddlewareChain | undefined, requestId: string, decision: string, userId: string, startTime: number): void {
    if (mw) {
      mw.execute('permission:afterResolve', {
        sessionId: this.session.id, requestId, decision, userId, durationMs: Date.now() - startTime,
      }, async (p) => p).catch(() => {});
    }
  }
}
