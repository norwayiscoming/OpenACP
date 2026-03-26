import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import type { DoctorCheck, CheckResult } from "../types.js";

const BIN_DIR = path.join(os.homedir(), ".openacp", "bin");
const BIN_NAME = os.platform() === "win32" ? "cloudflared.exe" : "cloudflared";
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);

export const tunnelCheck: DoctorCheck = {
  name: "Tunnel",
  order: 8,
  async run(ctx) {
    const results: CheckResult[] = [];

    if (!ctx.config) {
      results.push({ status: "fail", message: "Cannot check tunnel — config not loaded" });
      return results;
    }

    if (!ctx.config.tunnel.enabled) {
      results.push({ status: "pass", message: "Tunnel not enabled (skipped)" });
      return results;
    }

    const provider = ctx.config.tunnel.provider;
    results.push({ status: "pass", message: `Tunnel provider: ${provider}` });

    if (provider === "cloudflare") {
      let found = false;
      if (fs.existsSync(BIN_PATH)) {
        found = true;
      } else {
        try {
          execFileSync("which", ["cloudflared"], { stdio: "pipe" });
          found = true;
        } catch {
          // not found
        }
      }

      if (found) {
        results.push({ status: "pass", message: "cloudflared binary found" });
      } else {
        results.push({
          status: "warn",
          message: "cloudflared binary not found",
          fixable: true,
          fixRisk: "safe",
          fix: async () => {
            try {
              const { ensureCloudflared } = await import("../../../plugins/tunnel/providers/install-cloudflared.js");
              await ensureCloudflared();
              return { success: true, message: "installed cloudflared" };
            } catch (err) {
              return { success: false, message: err instanceof Error ? err.message : String(err) };
            }
          },
        });
      }
    }

    const tunnelPort = ctx.config.tunnel.port;
    if (tunnelPort < 1 || tunnelPort > 65535) {
      results.push({ status: "fail", message: `Invalid tunnel port: ${tunnelPort}` });
    } else {
      results.push({ status: "pass", message: `Tunnel port: ${tunnelPort}` });
    }

    return results;
  },
};
