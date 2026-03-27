import type { AgentEvent, OutgoingMessage } from "./types.js";
import type { TunnelServiceInterface } from "./plugin/types.js";
import { extractFileInfo } from "./utils/extract-file-info.js";
import { createChildLogger } from "./utils/log.js";

const log = createChildLogger({ module: "message-transformer" });

export class MessageTransformer {
  constructor(private tunnelService?: TunnelServiceInterface) {}

  transform(
    event: AgentEvent,
    sessionContext?: { id: string; workingDirectory: string },
  ): OutgoingMessage {
    switch (event.type) {
      case "text":
        return { type: "text", text: event.content };
      case "thought":
        return { type: "thought", text: event.content };
      case "tool_call": {
        const meta = event.meta as Record<string, unknown> | undefined;
        const metadata: Record<string, unknown> = {
          id: event.id,
          name: event.name,
          kind: event.kind,
          status: event.status,
          content: event.content,
          locations: event.locations,
          rawInput: event.rawInput,
          displaySummary: meta?.displaySummary,
          displayTitle: meta?.displayTitle,
          displayKind: meta?.displayKind,
        };
        this.enrichWithViewerLinks(event, metadata, sessionContext);
        return { type: "tool_call", text: event.name, metadata };
      }
      case "tool_update": {
        const meta = event.meta as Record<string, unknown> | undefined;
        const metadata: Record<string, unknown> = {
          id: event.id,
          name: event.name,
          kind: event.kind,
          status: event.status,
          content: event.content,
          rawInput: event.rawInput,
          displaySummary: meta?.displaySummary,
          displayTitle: meta?.displayTitle,
          displayKind: meta?.displayKind,
        };
        this.enrichWithViewerLinks(event, metadata, sessionContext);
        return { type: "tool_update", text: "", metadata };
      }
      case "plan":
        return {
          type: "plan",
          text: "",
          metadata: { entries: event.entries },
        };
      case "usage":
        return {
          type: "usage",
          text: "",
          metadata: {
            tokensUsed: event.tokensUsed,
            contextSize: event.contextSize,
            cost: event.cost,
          },
        };
      case "session_end":
        return { type: "session_end", text: `Done (${event.reason})` };
      case "error":
        return { type: "error", text: event.message };
      case "system_message":
        return { type: "system_message", text: event.message };
      case "session_info_update":
        return {
          type: "system_message",
          text: `Session updated: ${event.title ?? ""}`.trim(),
          metadata: { title: event.title, updatedAt: event.updatedAt },
        };
      case "current_mode_update":
        return {
          type: "mode_change",
          text: `Mode: ${event.modeId}`,
          metadata: { modeId: event.modeId },
        };
      case "config_option_update":
        return {
          type: "config_update",
          text: "Config updated",
          metadata: { options: event.options },
        };
      case "model_update":
        return {
          type: "model_update",
          text: `Model: ${event.modelId}`,
          metadata: { modelId: event.modelId },
        };
      case "user_message_chunk":
        return {
          type: "user_replay",
          text: event.content,
        };
      case "resource_content":
        return {
          type: "resource",
          text: event.name,
          metadata: { uri: event.uri, text: event.text, blob: event.blob, mimeType: event.mimeType },
        };
      case "resource_link":
        return {
          type: "resource_link",
          text: event.name,
          metadata: { uri: event.uri, mimeType: event.mimeType, title: event.title, description: event.description, size: event.size },
        };
      default:
        return { type: "text", text: "" };
    }
  }

  private enrichWithViewerLinks(
    event: AgentEvent & { type: "tool_call" | "tool_update" },
    metadata: Record<string, unknown>,
    sessionContext?: { id: string; workingDirectory: string },
  ): void {
    if (!this.tunnelService || !sessionContext) return;

    const name = "name" in event ? event.name || "" : "";
    const kind = "kind" in event ? event.kind : undefined;

    log.debug(
      { name, kind, status: event.status, hasContent: !!event.content },
      "enrichWithViewerLinks: inspecting event",
    );

    const fileInfo = extractFileInfo(
      name,
      kind,
      event.content,
      event.rawInput,
      event.meta,
    );
    if (!fileInfo) return;

    log.info(
      {
        name,
        kind,
        filePath: fileInfo.filePath,
        hasOldContent: !!fileInfo.oldContent,
      },
      "enrichWithViewerLinks: extracted file info",
    );

    const store = this.tunnelService.getStore();
    const viewerLinks: Record<string, string> = {};

    // For edits/writes with diff data (oldText + newText)
    if (fileInfo.oldContent) {
      const id = store.storeDiff(
        sessionContext.id,
        fileInfo.filePath,
        fileInfo.oldContent,
        fileInfo.content,
        sessionContext.workingDirectory,
      );
      if (id) viewerLinks.diff = this.tunnelService.diffUrl(id);
    }

    // Always store as file view (new file creation or read)
    const id = store.storeFile(
      sessionContext.id,
      fileInfo.filePath,
      fileInfo.content,
      sessionContext.workingDirectory,
    );
    if (id) viewerLinks.file = this.tunnelService.fileUrl(id);

    if (Object.keys(viewerLinks).length > 0) {
      metadata.viewerLinks = viewerLinks;
      metadata.viewerFilePath = fileInfo.filePath;
    }
  }
}
