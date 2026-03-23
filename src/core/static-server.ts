import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export class StaticServer {
  private uiDir: string | undefined;

  constructor(uiDir?: string) {
    this.uiDir = uiDir;

    if (!this.uiDir) {
      const __filename = fileURLToPath(import.meta.url);
      const candidate = path.resolve(path.dirname(__filename), "../../ui/dist");
      if (fs.existsSync(path.join(candidate, "index.html"))) {
        this.uiDir = candidate;
      }
      // Also check dist-publish layout
      if (!this.uiDir) {
        const publishCandidate = path.resolve(
          path.dirname(__filename),
          "../ui",
        );
        if (fs.existsSync(path.join(publishCandidate, "index.html"))) {
          this.uiDir = publishCandidate;
        }
      }
    }
  }

  isAvailable(): boolean {
    return this.uiDir !== undefined;
  }

  serve(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!this.uiDir) return false;

    const urlPath = (req.url || "/").split("?")[0];
    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");

    // Try exact file match
    const filePath = path.join(this.uiDir, safePath);
    if (!filePath.startsWith(this.uiDir + path.sep) && filePath !== this.uiDir)
      return false; // path traversal guard

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
      return true;
    }

    // SPA fallback — serve index.html
    const indexPath = path.join(this.uiDir, "index.html");
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(indexPath).pipe(res);
      return true;
    }

    return false;
  }
}
