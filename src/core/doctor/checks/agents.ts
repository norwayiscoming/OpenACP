import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DoctorCheck, CheckResult } from "../types.js";

function commandExists(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    // not in PATH
  }
  let dir = process.cwd();
  while (true) {
    const binPath = path.join(dir, "node_modules", ".bin", cmd);
    if (fs.existsSync(binPath)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

export const agentsCheck: DoctorCheck = {
  name: "Agents",
  order: 2,
  async run(ctx) {
    const results: CheckResult[] = [];
    if (!ctx.config) {
      results.push({ status: "fail", message: "Cannot check agents — config not loaded" });
      return results;
    }

    const agents = ctx.config.agents;
    const defaultAgent = ctx.config.defaultAgent;

    if (!agents[defaultAgent]) {
      results.push({
        status: "fail",
        message: `Default agent "${defaultAgent}" not found in agents config`,
      });
    }

    for (const [name, agent] of Object.entries(agents)) {
      const isDefault = name === defaultAgent;
      if (commandExists(agent.command)) {
        results.push({
          status: "pass",
          message: `${agent.command} found${isDefault ? " (default)" : ""}`,
        });
      } else {
        results.push({
          status: isDefault ? "fail" : "warn",
          message: `${agent.command} not found in PATH${isDefault ? " (default agent!)" : ""}`,
        });
      }
    }

    return results;
  },
};
