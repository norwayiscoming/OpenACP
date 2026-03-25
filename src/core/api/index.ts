import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { OpenACPCore } from "../core.js";
import type { TopicManager } from "../topic-manager.js";
import { createChildLogger } from "../log.js";
import { SSEManager } from "../sse-manager.js";
import { StaticServer } from "../static-server.js";
import { Router } from "./router.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerTopicRoutes } from "./routes/topics.js";
import { registerTunnelRoutes } from "./routes/tunnel.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerNotifyRoutes } from "./routes/notify.js";

const log = createChildLogger({ module: "api-server" });

const DEFAULT_PORT_FILE = path.join(os.homedir(), ".openacp", "api.port");

let cachedVersion: string | undefined;

function getVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const __filename = fileURLToPath(import.meta.url);
    const pkgPath = path.resolve(
      path.dirname(__filename),
      "../../../package.json",
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    cachedVersion = pkg.version ?? "0.0.0-dev";
  } catch {
    cachedVersion = "0.0.0-dev";
  }
  return cachedVersion!;
}

export interface ApiConfig {
  port: number;
  host: string;
}

/** Dependencies passed to route registration functions. */
export interface RouteDeps {
  core: OpenACPCore;
  topicManager?: TopicManager;
  startedAt: number;
  getVersion: () => string;
  sendJson: (res: http.ServerResponse, status: number, data: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<string | null>;
}

export class ApiServer {
  private server: http.Server | null = null;
  private actualPort: number = 0;
  private portFilePath: string;
  private startedAt = Date.now();
  private secret: string = "";
  private secretFilePath: string;
  private sseManager: SSEManager;
  private staticServer: StaticServer;
  private router: Router;

  constructor(
    private core: OpenACPCore,
    private config: ApiConfig,
    portFilePath?: string,
    private topicManager?: TopicManager,
    secretFilePath?: string,
    uiDir?: string,
  ) {
    this.portFilePath = portFilePath ?? DEFAULT_PORT_FILE;
    this.secretFilePath =
      secretFilePath ?? path.join(os.homedir(), ".openacp", "api-secret");
    this.staticServer = new StaticServer(uiDir);
    this.sseManager = new SSEManager(
      core.eventBus,
      () => {
        const sessions = this.core.sessionManager.listSessions();
        return {
          active: sessions.filter(
            (s) => s.status === "active" || s.status === "initializing",
          ).length,
          total: sessions.length,
        };
      },
      this.startedAt,
    );

    this.router = new Router();
    const deps: RouteDeps = {
      core: this.core,
      topicManager: this.topicManager,
      startedAt: this.startedAt,
      getVersion,
      sendJson: this.sendJson.bind(this),
      readBody: this.readBody.bind(this),
    };

    registerHealthRoutes(this.router, deps);
    registerSessionRoutes(this.router, deps);
    registerConfigRoutes(this.router, deps);
    registerTopicRoutes(this.router, deps);
    registerTunnelRoutes(this.router, deps);
    registerAgentRoutes(this.router, deps);
    registerNotifyRoutes(this.router, deps);
  }

  async start(): Promise<void> {
    this.loadOrCreateSecret();
    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    await new Promise<void>((resolve, reject) => {
      this.server!.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          log.warn(
            { port: this.config.port },
            "API port in use, continuing without API server",
          );
          this.server = null;
          // actualPort stays 0, port file not written
          resolve();
        } else {
          reject(err);
        }
      });

      this.server!.listen(this.config.port, this.config.host, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this.actualPort = addr.port;
        }
        this.writePortFile();
        log.info(
          { host: this.config.host, port: this.actualPort },
          "API server listening",
        );
        this.sseManager.setup();

        if (
          this.config.host !== "127.0.0.1" &&
          this.config.host !== "localhost"
        ) {
          log.warn(
            "API server binding to non-localhost. Ensure api-secret file is secured.",
          );
        }

        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.sseManager.stop();
    this.removePortFile();
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }

  getPort(): number {
    return this.actualPort;
  }

  getSecret(): string {
    return this.secret;
  }

  private writePortFile(): void {
    const dir = path.dirname(this.portFilePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.portFilePath, String(this.actualPort));
  }

  private removePortFile(): void {
    try {
      fs.unlinkSync(this.portFilePath);
    } catch {
      /* ignore */
    }
  }

  private loadOrCreateSecret(): void {
    const dir = path.dirname(this.secretFilePath);
    fs.mkdirSync(dir, { recursive: true });

    try {
      this.secret = fs.readFileSync(this.secretFilePath, "utf-8").trim();
      if (this.secret) {
        // Warn if file permissions are too open (like SSH does for private keys)
        try {
          const stat = fs.statSync(this.secretFilePath);
          const mode = stat.mode & 0o777;
          if (mode & 0o077) {
            log.warn(
              { path: this.secretFilePath, mode: "0" + mode.toString(8) },
              "API secret file has insecure permissions (should be 0600). Run: chmod 600 %s",
              this.secretFilePath,
            );
          }
        } catch {
          /* stat failed, skip check */
        }
        return;
      }
    } catch {
      // File doesn't exist, create it
    }

    this.secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(this.secretFilePath, this.secret, { mode: 0o600 });
  }

  private authenticate(
    req: http.IncomingMessage,
    allowQueryParam = false,
  ): boolean {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (
        token.length === this.secret.length &&
        crypto.timingSafeEqual(
          Buffer.from(token, "utf-8"),
          Buffer.from(this.secret, "utf-8"),
        )
      ) {
        return true;
      }
    }
    // Query param auth only for SSE (EventSource can't set headers)
    if (allowQueryParam) {
      const parsedUrl = new URL(req.url || "", "http://localhost");
      const qToken = parsedUrl.searchParams.get("token");
      if (
        qToken &&
        qToken.length === this.secret.length &&
        crypto.timingSafeEqual(
          Buffer.from(qToken, "utf-8"),
          Buffer.from(this.secret, "utf-8"),
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = req.method?.toUpperCase();
    const url = req.url || "";

    // Auth check: exempt health/version, SSE (has own auth), and non-/api/ routes (static files)
    if (url.startsWith("/api/")) {
      const isExempt =
        method === "GET" &&
        (url === "/api/health" ||
          url === "/api/version" ||
          url.startsWith("/api/events"));
      if (!isExempt && !this.authenticate(req)) {
        this.sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
    }

    try {
      // SSE endpoint — handled separately (streaming connection)
      if (method === "GET" && url.startsWith("/api/events")) {
        if (!this.authenticate(req, true)) {
          this.sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        this.sseManager.handleRequest(req, res);
        return; // Don't end the response — SSE keeps it open
      }

      // Try router for API routes
      if (url.startsWith("/api/")) {
        const match = this.router.match(method!, url);
        if (match) {
          await match.handler(req, res, match.params);
        } else {
          this.sendJson(res, 404, { error: "Not found" });
        }
        return;
      }

      // Try static file serving (UI dashboard) for non-API routes
      if (!this.staticServer.serve(req, res)) {
        this.sendJson(res, 404, { error: "Not found" });
      }
    } catch (err) {
      log.error({ err }, "API request error");
      this.sendJson(res, 500, { error: "Internal server error" });
    }
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    data: unknown,
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private readBody(req: http.IncomingMessage): Promise<string | null> {
    const MAX_BODY_SIZE = 1024 * 1024; // 1MB
    return new Promise((resolve) => {
      let data = "";
      let size = 0;
      let destroyed = false;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE && !destroyed) {
          destroyed = true;
          req.destroy();
          resolve(null);
          return;
        }
        if (!destroyed) data += chunk;
      });
      req.on("end", () => {
        if (!destroyed) resolve(data);
      });
      req.on("error", () => {
        if (!destroyed) resolve("");
      });
    });
  }
}
