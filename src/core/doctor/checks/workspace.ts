import * as fs from "node:fs";
import { expandHome } from "../../config.js";
import type { DoctorCheck, CheckResult } from "../types.js";

export const workspaceCheck: DoctorCheck = {
  name: "Workspace",
  order: 5,
  async run(ctx) {
    const results: CheckResult[] = [];

    if (!ctx.config) {
      results.push({ status: "fail", message: "Cannot check workspace — config not loaded" });
      return results;
    }

    const baseDir = expandHome(ctx.config.workspace.baseDir);

    if (!fs.existsSync(baseDir)) {
      results.push({
        status: "warn",
        message: `Workspace directory does not exist: ${baseDir}`,
        fixable: true,
        fixRisk: "safe",
        fix: async () => {
          fs.mkdirSync(baseDir, { recursive: true });
          return { success: true, message: "created directory" };
        },
      });
    } else {
      try {
        fs.accessSync(baseDir, fs.constants.W_OK);
        results.push({ status: "pass", message: `Workspace directory exists: ${baseDir}` });
      } catch {
        results.push({ status: "fail", message: `Workspace directory not writable: ${baseDir}` });
      }
    }

    return results;
  },
};
