import type { Session } from "./session.js";
import type { ChannelAdapter } from "./channel.js";
import type { MessageTransformer } from "./message-transformer.js";
import type { NotificationManager } from "./notification.js";
import type { SessionManager } from "./session-manager.js";
import type { AgentEvent, PermissionRequest, SessionStatus } from "./types.js";
import type { EventBus } from "./event-bus.js";
import { FileService } from "./file-service.js";
import { createChildLogger } from "./log.js";

const log = createChildLogger({ module: "session-bridge" });

export interface BridgeDeps {
  messageTransformer: MessageTransformer;
  notificationManager: NotificationManager;
  sessionManager: SessionManager;
  eventBus?: EventBus;
  fileService?: FileService;
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
    private adapter: ChannelAdapter,
    private deps: BridgeDeps,
  ) {}

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
    const session = this.session;
    const ctx = {
      get id() {
        return session.id;
      },
      get workingDirectory() {
        return session.workingDirectory;
      },
    };

    this.sessionEventHandler = (event: AgentEvent) => {
      switch (event.type) {
        case "text":
        case "thought":
        case "tool_call":
        case "tool_update":
        case "plan":
        case "usage":
          this.adapter.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event, ctx),
          );
          break;

        case "session_end":
          this.session.finish(event.reason);
          this.adapter.cleanupSkillCommands(this.session.id);
          this.adapter.sendMessage(
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
          this.adapter.cleanupSkillCommands(this.session.id);
          this.adapter.sendMessage(
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
                this.adapter.sendMessage(sid, {
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
                this.adapter.sendMessage(sid, {
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
          this.adapter.sendSkillCommands(this.session.id, event.commands);
          break;

        case "system_message":
          this.adapter.sendMessage(
            this.session.id,
            this.deps.messageTransformer.transform(event),
          );
          break;
      }

      this.deps.eventBus?.emit("agent:event", {
        sessionId: this.session.id,
        event,
      });
    };

    this.session.on("agent_event", this.sessionEventHandler);
  }

  private wirePermissions(): void {
    this.session.agentInstance.onPermissionRequest = async (
      request: PermissionRequest,
    ) => {
      this.session.emit("permission_request", request);
      this.deps.eventBus?.emit("permission:request", {
        sessionId: this.session.id,
        permission: request,
      });

      // Auto-approve openacp CLI commands
      if (request.description.toLowerCase().includes("openacp")) {
        const allowOption = request.options.find((o) => o.isAllow);
        if (allowOption) {
          log.info(
            { sessionId: this.session.id, requestId: request.id },
            "Auto-approving openacp command",
          );
          return allowOption.id;
        }
      }

      // Dangerous mode: auto-approve all permissions
      if (this.session.dangerousMode) {
        const allowOption = request.options.find((o) => o.isAllow);
        if (allowOption) {
          log.info(
            { sessionId: this.session.id, requestId: request.id, optionId: allowOption.id },
            "Dangerous mode: auto-approving permission",
          );
          return allowOption.id;
        }
      }

      // Set pending BEFORE sending UI to avoid race condition
      const promise = this.session.permissionGate.setPending(request);

      // Send permission UI to session topic
      await this.adapter.sendPermissionRequest(this.session.id, request);

      // Wait for user response — adapter resolves this promise
      return promise;
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
