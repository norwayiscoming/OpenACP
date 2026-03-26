import * as clack from "@clack/prompts";
import type { Config } from "../config.js";

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

export function summarizeConfig(config: Config): string {
  const lines: string[] = [];

  // Channels
  const channelStatuses: string[] = [];
  for (const [id, meta] of Object.entries({
    telegram: "Telegram",
    discord: "Discord",
  })) {
    const ch = config.channels[id] as { enabled?: boolean } | undefined;
    if (ch?.enabled) {
      channelStatuses.push(`${meta} (enabled)`);
    } else if (ch && Object.keys(ch).length > 1) {
      channelStatuses.push(`${meta} (disabled)`);
    } else {
      channelStatuses.push(`${meta} (not configured)`);
    }
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
