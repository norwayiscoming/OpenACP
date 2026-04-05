import * as clack from "@clack/prompts";
import type { Config } from "../config/config.js";
import type { SettingsManager } from "../plugin/settings-manager.js";

// --- ANSI colors ---

export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

export const ok = (msg: string) =>
  `${c.green}${c.bold}✓${c.reset} ${c.green}${msg}${c.reset}`;
export const warn = (msg: string) => `${c.yellow}⚠ ${msg}${c.reset}`;
export const fail = (msg: string) => `${c.red}✗ ${msg}${c.reset}`;
export const step = (n: number, total: number, title: string) =>
  `\n${c.cyan}${c.bold}[${n}/${total}]${c.reset} ${c.bold}${title}${c.reset}\n`;
export const dim = (msg: string) => `${c.dim}${msg}${c.reset}`;

export function guardCancel<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }
  return value as T;
}

// --- Banner ---

function applyGradient(text: string): string {
  const colors = [135, 99, 63, 33, 39, 44, 44];
  const lines = text.split("\n");
  return lines
    .map((line, i) => {
      const colorIdx = Math.min(i, colors.length - 1);
      return `\x1b[38;5;${colors[colorIdx]}m${line}\x1b[0m`;
    })
    .join("\n");
}

const BANNER = `
   ██████╗ ██████╗ ███████╗███╗   ██╗ █████╗  ██████╗██████╗
  ██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔══██╗██╔════╝██╔══██╗
  ██║   ██║██████╔╝█████╗  ██╔██╗ ██║███████║██║     ██████╔╝
  ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██╔══██║██║     ██╔═══╝
  ╚██████╔╝██║     ███████╗██║ ╚████║██║  ██║╚██████╗██║
   ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝ ╚═════╝╚═╝
`;

export async function printStartBanner(): Promise<void> {
  let version = "0.0.0";
  try {
    const { getCurrentVersion } = await import("../../cli/version.js");
    version = getCurrentVersion();
  } catch {
    // ignore
  }
  console.log(applyGradient(BANNER));
  console.log(`${c.dim}              AI coding agents, anywhere.  v${version}${c.reset}\n`);
}

// --- Config summary ---

export async function summarizeConfig(config: Config, settingsManager?: SettingsManager): Promise<string> {
  const lines: string[] = [];

  // Channels — check plugin settings (new-style) before falling back to config.channels (legacy)
  const channelDefs: Array<{ id: string; label: string; pluginName: string; keys: string[] }> = [
    { id: "telegram", label: "Telegram", pluginName: "@openacp/telegram", keys: ["botToken", "chatId"] },
    { id: "discord", label: "Discord", pluginName: "@openacp/discord-adapter", keys: ["guildId", "token"] },
  ];

  const channelStatuses: string[] = [];
  for (const def of channelDefs) {
    // Read channel status from plugin settings (channels migrated out of config.json)
    let configured = false;
    let enabled = false;

    if (settingsManager) {
      const ps = await settingsManager.loadSettings(def.pluginName);
      if (def.keys.some((k) => ps[k])) {
        configured = true;
        enabled = ps.enabled !== false;
      }
    }

    channelStatuses.push(`${def.label} (${enabled ? "enabled" : configured ? "disabled" : "not configured"})`);
  }
  lines.push(`Channels: ${channelStatuses.join(", ")}`);

  // Default agent
  lines.push(`Default agent: ${config.defaultAgent}`);

  // Workspace
  lines.push(`Workspace: ${config.workspace.baseDir}`);

  // Run mode
  lines.push(`Run mode: ${config.runMode}${config.autoStart ? " (auto-start)" : ""}`);

  return lines.join("\n");
}
