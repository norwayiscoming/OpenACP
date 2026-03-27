import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { Transform } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type {
  Agent,
  Client,
  PromptResponse,
  PermissionOption as SdkPermissionOption,
} from "@agentclientprotocol/sdk";
import { nodeToWebWritable, nodeToWebReadable } from "../utils/streams.js";
import { StderrCapture } from "../utils/stderr-capture.js";
import { TypedEmitter } from "../utils/typed-emitter.js";
import type {
  AgentDefinition,
  AgentEvent,
  Attachment,
  ConfigOption,
  McpServerConfig,
  PermissionRequest,
  SetConfigOptionValue,
} from "../types.js";
import { readTextFileWithRange } from "../utils/read-text-file.js";
import type { MiddlewareChain } from "../plugin/middleware-chain.js";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { TerminalManager } from "../sessions/terminal-manager.js";
import { McpManager } from "./mcp-manager.js";
import type {
  ListSessionsResponse,
  LoadSessionResponse,
  ForkSessionResponse,
  SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";
import { createChildLogger } from "../utils/log.js";
const log = createChildLogger({ module: "agent-instance" });

/** Find the nearest ancestor directory containing package.json */
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

/** Resolve an agent command to a directly executable form (avoids shell wrappers) */
function resolveAgentCommand(cmd: string): { command: string; args: string[] } {
  // Directories to search for node_modules: cwd AND the package's own directory
  const searchRoots = [process.cwd()];
  // Add the directory where this package is installed (for global installs)
  // Use findPackageRoot instead of hardcoded "../.." to handle both tsc (dist/core/)
  // and tsup bundle (dist/) directory structures correctly
  const ownDir = findPackageRoot(import.meta.dirname);
  if (ownDir !== process.cwd()) {
    searchRoots.push(ownDir);
  }

  // 1. Check node_modules for the package's actual JS entry point
  for (const root of searchRoots) {
    const packageDirs = [
      path.resolve(root, "node_modules", "@zed-industries", cmd, "dist", "index.js"),
      path.resolve(root, "node_modules", cmd, "dist", "index.js"),
    ];
    for (const jsPath of packageDirs) {
      if (fs.existsSync(jsPath)) {
        return { command: process.execPath, args: [jsPath] };
      }
    }
  }

  // 2. Check .bin — if it's a JS file with shebang, run with node directly
  for (const root of searchRoots) {
    const localBin = path.resolve(root, "node_modules", ".bin", cmd);
    if (fs.existsSync(localBin)) {
      const content = fs.readFileSync(localBin, "utf-8");
      if (content.startsWith("#!/usr/bin/env node")) {
        return { command: process.execPath, args: [localBin] };
      }
      // Shell wrapper — try to find the target JS file
      const match = content.match(/"([^"]+\.js)"/);
      if (match) {
        const target = path.resolve(path.dirname(localBin), match[1]);
        if (fs.existsSync(target)) {
          return { command: process.execPath, args: [target] };
        }
      }
    }
  }

  // 3. Try resolving from PATH using which
  try {
    const fullPath = execFileSync("which", [cmd], { encoding: "utf-8" }).trim();
    if (fullPath) {
      const content = fs.readFileSync(fullPath, "utf-8");
      if (content.startsWith("#!/usr/bin/env node")) {
        return { command: process.execPath, args: [fullPath] };
      }
    }
  } catch {
    // which failed
  }

  // 4. Fallback: use command as-is
  return { command: cmd, args: [] };
}

// TerminalState has been extracted to TerminalManager

// Local types for ACP session update shapes not fully typed by SDK
interface SdkToolCallFields {
  rawInput?: unknown;
  rawOutput?: unknown;
  _meta?: Record<string, unknown>;
}

interface SdkSessionInfoUpdate {
  sessionUpdate: 'session_info_update';
  title?: string | null;
  updatedAt?: string | null;
  _meta?: Record<string, unknown>;
}

interface SdkCurrentModeUpdate {
  sessionUpdate: 'current_mode_update';
  currentModeId: string;
  _meta?: Record<string, unknown>;
}

interface SdkConfigOptionUpdate {
  sessionUpdate: 'config_option_update';
  configOptions: unknown[];
  _meta?: Record<string, unknown>;
}

interface SdkUserMessageChunk {
  sessionUpdate: 'user_message_chunk';
  content: { type: string; text?: string };
}

interface SdkReadTextFileParams {
  path: string;
  line?: number;
  limit?: number;
}

export interface AgentInstanceEvents {
  agent_event: (event: AgentEvent) => void;
}

export class AgentInstance extends TypedEmitter<AgentInstanceEvents> {
  private connection!: ClientSideConnection;
  private child!: ChildProcess;
  private stderrCapture!: StderrCapture;
  private terminalManager = new TerminalManager();
  private static mcpManager = new McpManager();

  sessionId!: string;
  agentName: string;
  promptCapabilities?: { image?: boolean; audio?: boolean };
  middlewareChain?: MiddlewareChain;

  // Callback — set by core when wiring events
  onPermissionRequest: (request: PermissionRequest) => Promise<string> =
    async () => "";

  private constructor(agentName: string) {
    super();
    this.agentName = agentName;
  }

  private static async spawnSubprocess(
    agentDef: AgentDefinition,
    workingDirectory: string,
  ): Promise<AgentInstance> {
    const instance = new AgentInstance(agentDef.name);
    const resolved = resolveAgentCommand(agentDef.command);
    log.debug(
      {
        agentName: agentDef.name,
        command: resolved.command,
        args: resolved.args,
      },
      "Resolved agent command",
    );

    instance.child = spawn(
      resolved.command,
      [...resolved.args, ...agentDef.args],
      {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: workingDirectory,
        env: { ...process.env, ...agentDef.env },
      },
    );

    await new Promise<void>((resolve, reject) => {
      instance.child.on("error", (err) => {
        reject(
          new Error(
            `Failed to spawn agent "${agentDef.name}": ${err.message}. Is "${agentDef.command}" installed?`,
          ),
        );
      });
      instance.child.on("spawn", () => resolve());
    });

    instance.stderrCapture = new StderrCapture(50);
    instance.child.stderr!.on("data", (chunk: Buffer) => {
      instance.stderrCapture.append(chunk.toString());
    });

    const stdinLogger = new Transform({
      transform(chunk, _enc, cb) {
        log.debug(
          { direction: "send", raw: chunk.toString().trimEnd() },
          "ACP raw",
        );
        cb(null, chunk);
      },
    });
    stdinLogger.pipe(instance.child.stdin!);

    const stdoutLogger = new Transform({
      transform(chunk, _enc, cb) {
        log.debug(
          { direction: "recv", raw: chunk.toString().trimEnd() },
          "ACP raw",
        );
        cb(null, chunk);
      },
    });
    instance.child.stdout!.pipe(stdoutLogger);

    const toAgent = nodeToWebWritable(stdinLogger);
    const fromAgent = nodeToWebReadable(stdoutLogger);
    const stream = ndJsonStream(toAgent, fromAgent);

    instance.connection = new ClientSideConnection(
      (_agent: Agent): Client => instance.createClient(_agent),
      stream,
    );

    const initResponse = await instance.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });

    if (initResponse.protocolVersion !== PROTOCOL_VERSION) {
      log.warn(
        { expected: PROTOCOL_VERSION, got: initResponse.protocolVersion },
        "ACP protocol version mismatch — some features may not work correctly",
      );
    }

    instance.promptCapabilities =
      initResponse.agentCapabilities?.promptCapabilities;

    log.info(
      { promptCapabilities: instance.promptCapabilities ?? {} },
      "Agent prompt capabilities",
    );

    return instance;
  }

  private setupCrashDetection(): void {
    this.child.on("exit", (code, signal) => {
      log.info(
        { sessionId: this.sessionId, exitCode: code, signal },
        "Agent process exited",
      );
      if (code !== 0 && code !== null) {
        const stderr = this.stderrCapture.getLastLines();
        this.emit('agent_event', {
          type: "error",
          message: `Agent crashed (exit code ${code})\n${stderr}`,
        });
      }
    });

    this.connection.closed.then(() => {
      log.debug({ sessionId: this.sessionId }, "ACP connection closed");
    });
  }

  static async spawn(
    agentDef: AgentDefinition,
    workingDirectory: string,
    mcpServers?: McpServerConfig[],
  ): Promise<AgentInstance> {
    log.debug(
      { agentName: agentDef.name, command: agentDef.command },
      "Spawning agent",
    );
    const spawnStart = Date.now();

    const instance = await AgentInstance.spawnSubprocess(
      agentDef,
      workingDirectory,
    );

    const resolvedMcp = AgentInstance.mcpManager.resolve(mcpServers);
    const response = await instance.connection.newSession({
      cwd: workingDirectory,
      mcpServers: resolvedMcp as any,
    });
    instance.sessionId = response.sessionId;
    instance.setupCrashDetection();

    log.info(
      { sessionId: response.sessionId, durationMs: Date.now() - spawnStart },
      "Agent spawn complete",
    );
    return instance;
  }

  static async resume(
    agentDef: AgentDefinition,
    workingDirectory: string,
    agentSessionId: string,
    mcpServers?: McpServerConfig[],
  ): Promise<AgentInstance> {
    log.debug({ agentName: agentDef.name, agentSessionId }, "Resuming agent");
    const spawnStart = Date.now();

    const instance = await AgentInstance.spawnSubprocess(
      agentDef,
      workingDirectory,
    );

    try {
      const response = await instance.connection.unstable_resumeSession({
        sessionId: agentSessionId,
        cwd: workingDirectory,
      });
      instance.sessionId = response.sessionId;
      log.info(
        { sessionId: response.sessionId, durationMs: Date.now() - spawnStart },
        "Agent resume complete",
      );
    } catch (err) {
      log.warn(
        { err, agentSessionId },
        "Resume failed, falling back to new session",
      );
      const resolvedMcp = AgentInstance.mcpManager.resolve(mcpServers);
      const response = await instance.connection.newSession({
        cwd: workingDirectory,
        mcpServers: resolvedMcp as any,
      });
      instance.sessionId = response.sessionId;
      log.info(
        { sessionId: response.sessionId, durationMs: Date.now() - spawnStart },
        "Agent fallback spawn complete",
      );
    }

    instance.setupCrashDetection();
    return instance;
  }

  // createClient — implemented in Task 6b
  private createClient(_agent: Agent): Client {
    const self = this;
    const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB cap

    return {
      // ── Session updates ──────────────────────────────────────────────────
      async sessionUpdate(params) {
        const update = params.update;
        let event: AgentEvent | null = null;

        switch (update.sessionUpdate) {
          case "agent_message_chunk":
            if (update.content.type === "text") {
              event = { type: "text", content: update.content.text };
            } else if (update.content.type === "image") {
              // ACP SDK types don't expose data/mimeType fields for image content
              const c = update.content as unknown as { data: string; mimeType: string };
              event = { type: "image_content", data: c.data, mimeType: c.mimeType };
            } else if (update.content.type === "audio") {
              // ACP SDK types don't expose data/mimeType fields for audio content
              const c = update.content as unknown as { data: string; mimeType: string };
              event = { type: "audio_content", data: c.data, mimeType: c.mimeType };
            } else if (update.content.type === "resource") {
              // EmbeddedResource: content.resource is TextResourceContents or BlobResourceContents
              // TextResourceContents has { uri, text, mimeType? }
              // BlobResourceContents has { uri, blob, mimeType? }
              const c = update.content as unknown as {
                resource: { uri: string; text?: string; blob?: string; mimeType?: string };
                annotations?: { audience?: string[]; priority?: number };
              };
              // The EmbeddedResource content block doesn't carry a top-level name field —
              // use the uri as a fallback name since AgentEvent.resource_content requires one.
              event = {
                type: "resource_content",
                uri: c.resource.uri,
                name: c.resource.uri,
                text: c.resource.text ?? undefined,
                blob: c.resource.blob ?? undefined,
                mimeType: c.resource.mimeType ?? undefined,
              };
            } else if (update.content.type === "resource_link") {
              // ResourceLink: { uri, name, mimeType?, title?, description?, size? }
              const c = update.content as unknown as {
                uri: string;
                name: string;
                mimeType?: string | null;
                title?: string | null;
                description?: string | null;
                size?: number | null;
              };
              event = {
                type: "resource_link",
                uri: c.uri,
                name: c.name,
                mimeType: c.mimeType ?? undefined,
                title: c.title ?? undefined,
                description: c.description ?? undefined,
                size: c.size ?? undefined,
              };
            }
            break;
          case "agent_thought_chunk":
            if (update.content.type === "text") {
              event = { type: "thought", content: update.content.text };
            }
            break;
          case "tool_call": {
            const tc = update as unknown as SdkToolCallFields;
            event = {
              type: "tool_call",
              id: update.toolCallId,
              name: update.title,
              kind: update.kind ?? undefined,
              status: update.status ?? "pending",
              content: update.content ?? undefined,
              rawInput: tc.rawInput ?? undefined,
              rawOutput: tc.rawOutput ?? undefined,
              meta: tc._meta ?? undefined,
            };
            break;
          }
          case "tool_call_update": {
            const tcu = update as unknown as SdkToolCallFields;
            event = {
              type: "tool_update",
              id: update.toolCallId,
              name: update.title ?? undefined,
              kind: update.kind ?? undefined,
              status: update.status ?? "pending",
              content: update.content ?? undefined,
              rawInput: tcu.rawInput ?? undefined,
              rawOutput: tcu.rawOutput ?? undefined,
              meta: tcu._meta ?? undefined,
            };
            break;
          }
          case "plan":
            event = { type: "plan", entries: update.entries };
            break;
          case "usage_update":
            event = {
              type: "usage",
              tokensUsed: update.used,
              contextSize: update.size,
              cost: update.cost ?? undefined,
            };
            break;
          case "available_commands_update":
            event = {
              type: "commands_update",
              commands: update.availableCommands,
            };
            break;
          case "session_info_update": {
            const si = update as unknown as SdkSessionInfoUpdate;
            event = {
              type: "session_info_update",
              title: si.title ?? undefined,
              updatedAt: si.updatedAt ?? undefined,
              _meta: si._meta ?? undefined,
            };
            break;
          }
          case "current_mode_update": {
            const cm = update as unknown as SdkCurrentModeUpdate;
            event = {
              type: "current_mode_update",
              modeId: cm.currentModeId,
            };
            break;
          }
          case "config_option_update": {
            const co = update as unknown as SdkConfigOptionUpdate;
            event = {
              type: "config_option_update",
              options: (co.configOptions ?? []) as ConfigOption[],
            };
            break;
          }
          case "user_message_chunk": {
            const um = update as unknown as SdkUserMessageChunk;
            event = {
              type: "user_message_chunk",
              content: um.content?.text ?? "",
            };
            break;
          }
          // NOTE: model_update is NOT a session update type in the ACP SDK schema.
          // Model changes are applied via the unstable_setSessionModel() method and
          // the response is synchronous — the SDK does not push a model_update
          // notification to the client. Therefore AgentEvent "model_update" cannot
          // originate from sessionUpdate and must be emitted by callers of setModel()
          // if they need to propagate the change downstream.
          default:
            // Unknown update type — ignore
            return;
        }

        if (event !== null) {
          self.emit('agent_event', event);
        }
      },

      // ── Permission requests ──────────────────────────────────────────────
      async requestPermission(params) {
        const permissionRequest: PermissionRequest = {
          id: params.toolCall.toolCallId,
          description: params.toolCall.title ?? params.toolCall.toolCallId,
          options: params.options.map((opt: SdkPermissionOption) => ({
            id: opt.optionId,
            label: opt.name,
            isAllow: opt.kind === "allow_once" || opt.kind === "allow_always",
          })),
        };

        const selectedOptionId =
          await self.onPermissionRequest(permissionRequest);
        return {
          outcome: { outcome: "selected" as const, optionId: selectedOptionId },
        };
      },

      // ── File operations ──────────────────────────────────────────────────
      async readTextFile(params) {
        const p = params as unknown as SdkReadTextFileParams;
        // Hook: fs:beforeRead — modifiable, can block
        if (self.middlewareChain) {
          const result = await self.middlewareChain.execute('fs:beforeRead', { sessionId: self.sessionId, path: p.path, line: p.line, limit: p.limit }, async (r) => r);
          if (!result) return { content: "" }; // blocked by middleware
          p.path = result.path;
        }
        const content = await readTextFileWithRange(p.path, {
          line: p.line ?? undefined,
          limit: p.limit ?? undefined,
        });
        return { content };
      },

      async writeTextFile(params) {
        // Hook: fs:beforeWrite — modifiable, can block
        let writePath = params.path;
        let writeContent = params.content;
        if (self.middlewareChain) {
          const result = await self.middlewareChain.execute('fs:beforeWrite', { sessionId: self.sessionId, path: writePath, content: writeContent }, async (r) => r);
          if (!result) return {}; // blocked by middleware
          writePath = result.path;
          writeContent = result.content;
        }
        await fs.promises.mkdir(path.dirname(writePath), { recursive: true });
        await fs.promises.writeFile(writePath, writeContent, "utf-8");
        return {};
      },

      // ── Terminal operations (delegated to TerminalManager) ─────────────
      async createTerminal(params) {
        return self.terminalManager.createTerminal(
          self.sessionId,
          {
            command: params.command,
            args: params.args,
            env: params.env,
            cwd: params.cwd,
            outputByteLimit: params.outputByteLimit ?? MAX_OUTPUT_BYTES,
          },
          self.middlewareChain,
        );
      },

      async terminalOutput(params) {
        return self.terminalManager.getOutput(params.terminalId);
      },

      async waitForTerminalExit(params) {
        return self.terminalManager.waitForExit(params.terminalId);
      },

      async killTerminal(params) {
        self.terminalManager.kill(params.terminalId);
        return {};
      },

      async releaseTerminal(params) {
        self.terminalManager.release(params.terminalId);
      },
    };
  }

  // ── New ACP methods ──────────────────────────────────────────────────

  async setMode(modeId: string): Promise<void> {
    await this.connection.setSessionMode({ sessionId: this.sessionId, modeId });
  }

  async setConfigOption(
    configId: string,
    value: SetConfigOptionValue,
  ): Promise<SetSessionConfigOptionResponse> {
    return await this.connection.setSessionConfigOption({
      sessionId: this.sessionId,
      configId,
      ...value,
    } as any);
  }

  async setModel(modelId: string): Promise<void> {
    await this.connection.unstable_setSessionModel({
      sessionId: this.sessionId,
      modelId,
    });
  }

  async listSessions(
    cwd?: string,
    cursor?: string,
  ): Promise<ListSessionsResponse> {
    return await this.connection.listSessions({
      cwd: cwd ?? null,
      cursor: cursor ?? null,
    });
  }

  async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers?: McpServerConfig[],
  ): Promise<LoadSessionResponse> {
    const resolvedMcp = AgentInstance.mcpManager.resolve(mcpServers);
    return await this.connection.loadSession({
      sessionId,
      cwd,
      mcpServers: resolvedMcp as any,
    });
  }

  async authenticate(methodId: string): Promise<void> {
    await this.connection.authenticate({ methodId });
  }

  async forkSession(
    sessionId: string,
    cwd: string,
    mcpServers?: McpServerConfig[],
  ): Promise<ForkSessionResponse> {
    const resolvedMcp = AgentInstance.mcpManager.resolve(mcpServers);
    return await this.connection.unstable_forkSession({
      sessionId,
      cwd,
      mcpServers: resolvedMcp as any,
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.connection.unstable_closeSession({ sessionId });
  }

  // ── Prompt & lifecycle ──────────────────────────────────────────────

  async prompt(text: string, attachments?: Attachment[]): Promise<PromptResponse> {
    const contentBlocks: Array<Record<string, unknown>> = [{ type: "text", text }];

    // MIME types supported by Claude API for base64 image content
    const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

    for (const att of attachments ?? []) {
      const tooLarge = att.size > 10 * 1024 * 1024; // 10MB base64 guard

      if (att.type === "image" && this.promptCapabilities?.image && !tooLarge && SUPPORTED_IMAGE_MIMES.has(att.mimeType)) {
        const data = await fs.promises.readFile(att.filePath);
        contentBlocks.push({ type: "image", data: data.toString("base64"), mimeType: att.mimeType });
      } else if (att.type === "audio" && this.promptCapabilities?.audio && !tooLarge) {
        const data = await fs.promises.readFile(att.filePath);
        contentBlocks.push({ type: "audio", data: data.toString("base64"), mimeType: att.mimeType });
      } else {
        // Fallback: append file path to text so agent can read from disk
        if ((att.type === "image" || att.type === "audio") && !tooLarge) {
          log.debug(
            { type: att.type, capabilities: this.promptCapabilities ?? {} },
            "Agent does not support %s content, falling back to file path",
            att.type,
          );
        }
        (contentBlocks[0] as { text: string }).text += `\n\n[Attached file: ${att.filePath}]`;
      }
    }

    return this.connection.prompt({
      sessionId: this.sessionId,
      prompt: contentBlocks as any,
    });
  }

  async cancel(): Promise<void> {
    await this.connection.cancel({ sessionId: this.sessionId });
  }

  async destroy(): Promise<void> {
    // Cleanup terminals
    this.terminalManager.destroyAll();

    // Kill agent subprocess
    this.child.kill("SIGTERM");
    setTimeout(() => {
      if (!this.child.killed) this.child.kill("SIGKILL");
    }, 10_000);
  }
}
