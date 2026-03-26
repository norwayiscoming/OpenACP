import type { Session } from "./session.js";
import type { IChannelAdapter } from "../channel.js";
import type { MessageTransformer } from "../message-transformer.js";
import type { NotificationManager } from "../notification.js";
import type { SessionManager } from "./session-manager.js";
import type { AgentEvent, PermissionRequest, SessionStatus } from "../types.js";
import type { EventBus } from "../event-bus.js";
import { FileService } from "../utils/file-service.js";
import type { MiddlewareChain } from "../plugin/middleware-chain.js";
import { createChildLogger } from "../utils/log.js";

const log = createChildLogger({ module: "session-bridge" });

export interface BridgeDeps {
  messageTransformer: MessageTransformer;
  notificationManager: NotificationManager;
  sessionManager: SessionManager;
  eventBus?: EventBus;
  fileService?: FileService;
  middlewareChain?: MiddlewareChain;
}

export class SessionBridge {
  private connected = false;
  private agentEventHandler?: (event: AgentEvent) => void;
  private sessionEventHandler?: (event: AgentEvent) => void;
  private statusChangeHandler?: (
    from: SessionStatus,
    to: SessionStatus,
  ) => void;
  private namedHandler?: (name: string) => void;

  constructor(
    private session: Session,
    private adapter: IChannelAdapter,
    private deps: BridgeDeps,
  ) {}

  /** Send message to adapter, optionally running through message:outgoing middleware */
  private async sendMessage(sessionId: string, message: ReturnType<MessageTransformer["transform"]>): Promise<void> {
    const mw = this.deps.middlewareChain;
    if (mw) {
      const result = await mw.execute('message:outgoing', message, async (m) => m);
      if (!result) return; // blocked by middleware
      this.adapter.sendMessage(sessionId, result);
    } else {
      this.adapter.sendMessage(sessionId, message);
    }
  }

  connect(): void {
    if (this.connected) return;
    this.connected = true;

    this.wireAgentToSession();
    this.wireSessionToAdapter();
    this.wirePermissions();
    this.wireLifecycle();
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;

    if (this.agentEventHandler) {
      this.session.agentInstance.off("agent_event", this.agentEventHandler);
    }
    if (this.sessionEventHandler) {
      this.session.off("agent_event", this.sessionEventHandler);
    }
    if (this.statusChangeHandler) {
      this.session.off("status_change", this.statusChangeHandler);
    }
    if (this.namedHandler) {
      this.session.off("named", this.namedHandler);
    }

    // Reset agent callbacks to no-op
    this.session.agentInstance.onPermissionRequest = async () => "";
  }

  private wireAgentToSession(): void {
    this.agentEventHandler = (event: AgentEvent) => {
      this.session.emit("agent_event", event);
    };
    this.session.agentInstance.on("agent_event", this.agentEventHandler);
  }

  private wireSessionToAdapter(): void {
    this.sessionEventHandler = (event: AgentEvent) => {
      // Hook: agent:beforeEvent — modifiable, can block
      const mw = this.deps.middlewareChain;
      if (mw) {
        mw.execute('agent:beforeEvent', event, async (e) => e).then((result) => {
          if (!result) return; // blocked by middleware
          this.handleAgentEvent(result);
          // Hook: agent:afterEvent — read-only, fire-and-forget
          mw.execute('agent:afterEvent', result, async (e) => e).catch(() => {});
        }).catch(() => {
          // Middleware error — proceed with original event
          this.handleAgentEvent(event);
        });
      } else {
        this.handleAgentEvent(event);
      }
    };

    this.session.on("agent_event", this.sessionEventHandler);
  }

  private handleAgentEvent(event: AgentEvent): void {
    const session = this.session;
    const ctx = {
      get id() {
        return session.id;
      },
      get workingDirectory() {
        return session.workingDirectory;
      },
    };

      switch (event.type) {
        case "text":
        case "thought":
        case "tool_call":
        case "tool_update":
        case "plan":
        case "usage":
          this.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event, ctx),
          );
          break;

        case "session_end":
          this.session.finish(event.reason);
          this.adapter.cleanupSkillCommands?.(this.session.id);
          this.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event),
          );
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
          this.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event),
          );
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
            const ext = FileService.extensionFromMime(mimeType);
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
            const ext = FileService.extensionFromMime(mimeType);
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
          this.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event),
          );
          break;

        case "session_info_update":
          if (event.title) {
            this.session.setName(event.title);
          }
          this.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event),
          );
          break;

        case "current_mode_update":
          this.session.updateMode(event.modeId);
          this.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event),
          );
          break;

        case "config_option_update":
          this.session.updateConfigOptions(event.options);
          this.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event),
          );
          break;

        case "model_update":
          this.session.updateModel(event.modelId);
          this.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event),
          );
          break;

        case "user_message_chunk":
          this.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event),
          );
          break;

        case "resource_content":
        case "resource_link":
          this.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event),
          );
          break;
      }

      this.deps.eventBus?.emit("agent:event", {
        sessionId: this.session.id,
        event,
      });
  }

  private wirePermissions(): void {
    const mw = this.deps.middlewareChain;

    this.session.agentInstance.onPermissionRequest = async (
      request: PermissionRequest,
    ) => {
      // Hook: permission:beforeRequest — modifiable, can block
      let permReq = request;
      if (mw) {
        const result = await mw.execute('permission:beforeRequest', request, async (r) => r);
        if (!result) return ""; // blocked by middleware
        permReq = result;
      }

      this.session.emit("permission_request", permReq);
      this.deps.eventBus?.emit("permission:request", {
        sessionId: this.session.id,
        permission: permReq,
      });

      // Auto-approve openacp CLI commands
      if (permReq.description.toLowerCase().includes("openacp")) {
        const allowOption = permReq.options.find((o) => o.isAllow);
        if (allowOption) {
          log.info(
            { sessionId: this.session.id, requestId: permReq.id },
            "Auto-approving openacp command",
          );
          // Hook: permission:afterResolve — read-only, fire-and-forget
          if (mw) {
            mw.execute('permission:afterResolve', { request: permReq, optionId: allowOption.id }, async (p) => p).catch(() => {});
          }
          return allowOption.id;
        }
      }

      // Dangerous mode: auto-approve all permissions
      if (this.session.dangerousMode) {
        const allowOption = permReq.options.find((o) => o.isAllow);
        if (allowOption) {
          log.info(
            { sessionId: this.session.id, requestId: permReq.id, optionId: allowOption.id },
            "Dangerous mode: auto-approving permission",
          );
          // Hook: permission:afterResolve — read-only, fire-and-forget
          if (mw) {
            mw.execute('permission:afterResolve', { request: permReq, optionId: allowOption.id }, async (p) => p).catch(() => {});
          }
          return allowOption.id;
        }
      }

      // Set pending BEFORE sending UI to avoid race condition
      const promise = this.session.permissionGate.setPending(permReq);

      // Send permission UI to session topic
      await this.adapter.sendPermissionRequest(this.session.id, permReq);

      // Wait for user response — adapter resolves this promise
      const optionId = await promise;

      // Hook: permission:afterResolve — read-only, fire-and-forget
      if (mw) {
        mw.execute('permission:afterResolve', { request: permReq, optionId }, async (p) => p).catch(() => {});
      }

      return optionId;
    };
  }

  private wireLifecycle(): void {
    // Persist status changes and auto-disconnect on terminal states
    this.statusChangeHandler = (from: SessionStatus, to: SessionStatus) => {
      this.deps.sessionManager.patchRecord(this.session.id, {
        status: to,
        lastActiveAt: new Date().toISOString(),
      });
      this.deps.eventBus?.emit("session:updated", {
        sessionId: this.session.id,
        status: to,
      });

      // Auto-disconnect on terminal states
      if (to === "finished" || to === "cancelled") {
        // Disconnect on next tick so current event handlers can complete
        queueMicrotask(() => this.disconnect());
      }
    };
    this.session.on("status_change", this.statusChangeHandler);

    // Persist and relay name changes
    this.namedHandler = (name: string) => {
      this.deps.sessionManager.patchRecord(this.session.id, { name });
      this.deps.eventBus?.emit("session:updated", {
        sessionId: this.session.id,
        name,
      });
      this.adapter.renameSessionThread(this.session.id, name);
    };
    this.session.on("named", this.namedHandler);
  }
}
