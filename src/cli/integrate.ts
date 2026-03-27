import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { getAgentCapabilities, commandExists, listAgentsWithIntegration } from "../core/agents/agent-dependencies.js";
import type { AgentIntegrationSpec } from "../core/agents/agent-dependencies.js";

export interface IntegrationResult {
  success: boolean;
  logs: string[];
}

export interface IntegrationItem {
  id: string;
  name: string;
  description: string;
  isInstalled(): boolean;
  install(): Promise<IntegrationResult>;
  uninstall(): Promise<IntegrationResult>;
}

export interface AgentIntegration {
  items: IntegrationItem[];
}

const HOOK_MARKER = "openacp-inject-session.sh";

function expandPath(p: string): string {
  return p.replace(/^~/, homedir());
}

// --- Script generators ---

function generateInjectScript(_agentKey: string, spec: AgentIntegrationSpec): string {
  const sidVar = spec.sessionIdVar ?? "SESSION_ID";
  const cwdVar = spec.workingDirVar ?? "WORKING_DIR";

  // Resolve jq: check ~/.openacp/bin first, then PATH
  const jqResolver = `JQ=$(command -v jq 2>/dev/null || echo "$HOME/.openacp/bin/jq")`;

  if (spec.outputFormat === "plaintext") {
    return `#!/bin/bash
${jqResolver}
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | "$JQ" -r '${spec.sessionIdField}')
CWD=$(echo "$INPUT" | "$JQ" -r '.cwd')

echo "${sidVar}: $SESSION_ID"
echo "${cwdVar}: $CWD"

exit 0
`;
  }

  // JSON output (Gemini, Cline, Cursor)
  return `#!/bin/bash
${jqResolver}
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | "$JQ" -r '${spec.sessionIdField}')
CWD=$(echo "$INPUT" | "$JQ" -r '.cwd')

"$JQ" -n --arg sid "$SESSION_ID" --arg cwd "$CWD" \\
  '{"additionalContext":"${sidVar}: \\($sid)\\n${cwdVar}: \\($cwd)"}'

exit 0
`;
}

function generateHandoffScript(agentKey: string): string {
  return `#!/bin/bash
SESSION_ID=$1
CWD=$2
CHANNEL=$3

if [ -z "$SESSION_ID" ]; then
  echo "Usage: openacp-handoff.sh <session_id> [cwd] [channel]"
  exit 1
fi

openacp adopt ${agentKey} "$SESSION_ID" \${CWD:+--cwd "$CWD"} \${CHANNEL:+--channel "$CHANNEL"}
`;
}

function generateTunnelCommand(): string {
  return `---
description: Expose local ports to the internet. Use when user wants to share, preview, or access their local dev server remotely. Triggers on phrases like "expose port", "map port", "share my app", "make it public", "open tunnel", "public URL", "share localhost", "preview on phone", "access from outside", "forward port", "ngrok", "cloudflare tunnel", etc.
---

You have access to OpenACP tunnel management via CLI. This creates a public URL for any local port (dev servers, APIs, static sites, etc.) using Cloudflare tunnel.

## Commands

\`\`\`bash
# Create a tunnel — exposes local port to the internet
openacp tunnel add <port> --label <name>

# List all active tunnels with their public URLs
openacp tunnel list

# Stop a specific tunnel
openacp tunnel stop <port>

# Stop all tunnels
openacp tunnel stop-all
\`\`\`

## When to use

User wants to:
- **Share their local app** — "share this on my phone", "let my friend see this", "preview on mobile"
- **Expose a port** — "expose port 3000", "map port 5173", "make port 8080 public"
- **Get a public URL** — "give me a public URL", "I need an external link", "make localhost accessible"
- **Open a tunnel** — "open tunnel", "start tunnel", "tunnel this"
- **Forward/proxy a port** — "forward port 3000", "proxy my server"
- **Deploy preview** — "deploy preview", "share a preview link"
- **Access remotely** — "access from my phone", "access from outside"
- **Manage tunnels** — "show tunnels", "list tunnels", "stop tunnel", "close tunnel", "kill tunnel"

## How to respond

1. Run the CLI command
2. Share the public URL with the user
3. Mention the URL works on any device (phone, tablet, other computer)
4. If the user hasn't started a dev server yet, remind them to start one first

## Example flow

User: "I want to see this React app on my phone"
→ Check if dev server is running (e.g. port 5173 for Vite)
→ Run: \`openacp tunnel add 5173 --label react-app\`
→ Share the public URL
`;
}

function generateHandoffCommand(_agentKey: string, spec: AgentIntegrationSpec): string {
  const sidVar = spec.sessionIdVar ?? "SESSION_ID";
  const cwdVar = spec.workingDirVar ?? "WORKING_DIR";
  const hooksDir = expandPath(spec.hooksDirPath);

  return `---
description: Transfer current session to OpenACP (Telegram/Discord)
---

Look at the context injected at the start of this message to find
${sidVar} and ${cwdVar}, then run:

bash ${hooksDir}openacp-handoff.sh <${sidVar}> <${cwdVar}> <args if any>

Usage: /openacp:handoff [channel]
  channel: name of a registered adapter (e.g. telegram), or omit for default

Examples:
  /openacp:handoff
  /openacp:handoff telegram
`;
}

// --- Settings mergers ---

function mergeSettingsJson(settingsPath: string, hookEvent: string, hookScriptPath: string): void {
  const fullPath = expandPath(settingsPath);
  let settings: Record<string, unknown> = {};

  if (existsSync(fullPath)) {
    const raw = readFileSync(fullPath, "utf-8");
    writeFileSync(`${fullPath}.bak`, raw);
    settings = JSON.parse(raw);
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  settings.hooks = hooks;

  const eventHooks = (hooks[hookEvent] ?? []) as Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
  hooks[hookEvent] = eventHooks;

  const alreadyInstalled = eventHooks.some((group) =>
    group.hooks?.some((h) => h.command?.includes(HOOK_MARKER)),
  );

  if (!alreadyInstalled) {
    eventHooks.push({
      hooks: [{ type: "command", command: hookScriptPath }],
    });
  }

  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(settings, null, 2) + "\n");
}

function mergeHooksJson(settingsPath: string, hookEvent: string, hookScriptPath: string): void {
  const fullPath = expandPath(settingsPath);
  let config: Record<string, unknown> = { version: 1 };

  if (existsSync(fullPath)) {
    const raw = readFileSync(fullPath, "utf-8");
    writeFileSync(`${fullPath}.bak`, raw);
    config = JSON.parse(raw);
  }

  const hooks = (config.hooks ?? {}) as Record<string, unknown[]>;
  config.hooks = hooks;

  const eventHooks = (hooks[hookEvent] ?? []) as Array<{ command?: string }>;
  hooks[hookEvent] = eventHooks;

  const alreadyInstalled = eventHooks.some((h) => h.command?.includes(HOOK_MARKER));

  if (!alreadyInstalled) {
    eventHooks.push({ command: hookScriptPath });
  }

  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(config, null, 2) + "\n");
}

function removeFromSettingsJson(settingsPath: string, hookEvent: string): void {
  const fullPath = expandPath(settingsPath);
  if (!existsSync(fullPath)) return;

  const raw = readFileSync(fullPath, "utf-8");
  const settings = JSON.parse(raw);
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks?.[hookEvent]) return;

  hooks[hookEvent] = (hooks[hookEvent] as Array<{ hooks?: Array<{ command?: string }> }>).filter(
    (group) => !group.hooks?.some((h) => h.command?.includes("openacp-")),
  );

  if ((hooks[hookEvent] as unknown[]).length === 0) {
    delete hooks[hookEvent];
  }

  writeFileSync(fullPath, JSON.stringify(settings, null, 2) + "\n");
}

function removeFromHooksJson(settingsPath: string, hookEvent: string): void {
  const fullPath = expandPath(settingsPath);
  if (!existsSync(fullPath)) return;

  const raw = readFileSync(fullPath, "utf-8");
  const config = JSON.parse(raw);
  const hooks = config.hooks as Record<string, unknown[]> | undefined;
  if (!hooks?.[hookEvent]) return;

  hooks[hookEvent] = (hooks[hookEvent] as Array<{ command?: string }>).filter(
    (h) => !h.command?.includes("openacp-"),
  );

  if ((hooks[hookEvent] as unknown[]).length === 0) {
    delete hooks[hookEvent];
  }

  writeFileSync(fullPath, JSON.stringify(config, null, 2) + "\n");
}

// --- Core install/uninstall ---

export async function installIntegration(agentKey: string, spec: AgentIntegrationSpec): Promise<IntegrationResult> {
  const logs: string[] = [];
  try {
    // Check jq
    if (!commandExists("jq")) {
      return {
        success: false,
        logs: ["jq is required for handoff hooks. Install: brew install jq (macOS) or apt install jq (Linux)"],
      };
    }

    const hooksDir = expandPath(spec.hooksDirPath);
    mkdirSync(hooksDir, { recursive: true });

    // Inject script
    const injectPath = join(hooksDir, "openacp-inject-session.sh");
    writeFileSync(injectPath, generateInjectScript(agentKey, spec));
    chmodSync(injectPath, 0o755);
    logs.push(`Created ${injectPath}`);

    // Handoff script
    const handoffPath = join(hooksDir, "openacp-handoff.sh");
    writeFileSync(handoffPath, generateHandoffScript(agentKey));
    chmodSync(handoffPath, 0o755);
    logs.push(`Created ${handoffPath}`);

    // Slash command / skill
    if (spec.commandsPath && spec.handoffCommandName) {
      if (spec.commandFormat === "skill") {
        const skillDir = expandPath(join(spec.commandsPath, spec.handoffCommandName));
        mkdirSync(skillDir, { recursive: true });
        const skillPath = join(skillDir, "SKILL.md");
        writeFileSync(skillPath, generateHandoffCommand(agentKey, spec));
        logs.push(`Created ${skillPath}`);
      } else {
        const cmdsDir = expandPath(spec.commandsPath);
        mkdirSync(cmdsDir, { recursive: true });
        const cmdPath = join(cmdsDir, `${spec.handoffCommandName}.md`);
        writeFileSync(cmdPath, generateHandoffCommand(agentKey, spec));
        logs.push(`Created ${cmdPath}`);
      }
    }

    // Merge settings
    const injectFullPath = join(hooksDir, "openacp-inject-session.sh");
    if (spec.settingsFormat === "hooks_json") {
      mergeHooksJson(spec.settingsPath, spec.hookEvent, injectFullPath);
    } else {
      mergeSettingsJson(spec.settingsPath, spec.hookEvent, injectFullPath);
    }
    logs.push(`Updated ${expandPath(spec.settingsPath)}`);

    return { success: true, logs };
  } catch (err) {
    logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, logs };
  }
}

export async function uninstallIntegration(agentKey: string, spec: AgentIntegrationSpec): Promise<IntegrationResult> {
  const logs: string[] = [];
  try {
    const hooksDir = expandPath(spec.hooksDirPath);

    // Remove hook scripts
    for (const filename of ["openacp-inject-session.sh", "openacp-handoff.sh"]) {
      const filePath = join(hooksDir, filename);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        logs.push(`Removed ${filePath}`);
      }
    }

    // Remove slash command / skill
    if (spec.commandsPath && spec.handoffCommandName) {
      if (spec.commandFormat === "skill") {
        const skillDir = expandPath(join(spec.commandsPath, spec.handoffCommandName));
        const skillPath = join(skillDir, "SKILL.md");
        if (existsSync(skillPath)) {
          unlinkSync(skillPath);
          try { rmdirSync(skillDir); } catch { /* not empty */ }
          logs.push(`Removed ${skillPath}`);
        }
      } else {
        const cmdPath = expandPath(join(spec.commandsPath, `${spec.handoffCommandName}.md`));
        if (existsSync(cmdPath)) {
          unlinkSync(cmdPath);
          logs.push(`Removed ${cmdPath}`);
        }
      }
    }

    // Clean settings
    if (spec.settingsFormat === "hooks_json") {
      removeFromHooksJson(spec.settingsPath, spec.hookEvent);
    } else {
      removeFromSettingsJson(spec.settingsPath, spec.hookEvent);
    }
    logs.push(`Updated ${expandPath(spec.settingsPath)}`);

    return { success: true, logs };
  } catch (err) {
    logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, logs };
  }
}

// --- Public API (backward compat with existing cmdIntegrate / Telegram integrate) ---

function buildHandoffItem(agentKey: string, spec: AgentIntegrationSpec): IntegrationItem {
  const hooksDir = expandPath(spec.hooksDirPath);
  return {
    id: "handoff",
    name: "Handoff",
    description: "Transfer sessions between terminal and messaging platforms",
    isInstalled(): boolean {
      return (
        existsSync(join(hooksDir, "openacp-inject-session.sh")) &&
        existsSync(join(hooksDir, "openacp-handoff.sh"))
      );
    },
    install: () => installIntegration(agentKey, spec),
    uninstall: () => uninstallIntegration(agentKey, spec),
  };
}

function getSkillBasePath(spec: AgentIntegrationSpec): string {
  // Skills go into the agent's skills directory (sibling to commands)
  // Claude: ~/.claude/skills/, Cursor: ~/.cursor/skills/
  const base = spec.commandsPath!;
  // If commandsPath is commands/, use skills/ instead
  const skillsBase = base.replace(/\/commands\/?$/, "/skills/");
  return expandPath(skillsBase);
}

function buildTunnelItem(spec: AgentIntegrationSpec): IntegrationItem | null {
  if (!spec.commandsPath) return null;

  function getTunnelPath(): string {
    return join(getSkillBasePath(spec), "openacp-tunnel", "SKILL.md");
  }

  return {
    id: "tunnel",
    name: "Tunnel",
    description: "Expose local ports to the internet via OpenACP tunnel",
    isInstalled(): boolean {
      return existsSync(getTunnelPath());
    },
    async install(): Promise<IntegrationResult> {
      const logs: string[] = [];
      try {
        const skillPath = getTunnelPath();
        mkdirSync(dirname(skillPath), { recursive: true });
        writeFileSync(skillPath, generateTunnelCommand());
        logs.push(`Created ${skillPath}`);
        return { success: true, logs };
      } catch (err) {
        logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
        return { success: false, logs };
      }
    },
    async uninstall(): Promise<IntegrationResult> {
      const logs: string[] = [];
      try {
        const skillPath = getTunnelPath();
        if (existsSync(skillPath)) {
          unlinkSync(skillPath);
          try { rmdirSync(dirname(skillPath)); } catch { /* not empty */ }
          logs.push(`Removed ${skillPath}`);
        }
        return { success: true, logs };
      } catch (err) {
        logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
        return { success: false, logs };
      }
    },
  };
}

export function getIntegration(agentName: string): AgentIntegration | undefined {
  const caps = getAgentCapabilities(agentName);
  if (!caps.integration) return undefined;
  const items: IntegrationItem[] = [buildHandoffItem(agentName, caps.integration)];
  const tunnelItem = buildTunnelItem(caps.integration);
  if (tunnelItem) items.push(tunnelItem);
  return { items };
}

export function listIntegrations(): string[] {
  return listAgentsWithIntegration();
}
