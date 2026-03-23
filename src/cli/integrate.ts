import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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

// --- Claude integration ---

const CLAUDE_DIR = join(homedir(), ".claude");
const HOOKS_DIR = join(CLAUDE_DIR, "hooks");
const COMMANDS_DIR = join(CLAUDE_DIR, "commands");
const SETTINGS_FILE = join(CLAUDE_DIR, "settings.json");

const INJECT_HOOK_FILE = join(HOOKS_DIR, "openacp-inject-session.sh");
const HANDOFF_SCRIPT_FILE = join(HOOKS_DIR, "openacp-handoff.sh");
const HANDOFF_COMMAND_FILE = join(COMMANDS_DIR, "openacp:handoff.md");

const INJECT_HOOK_CONTENT = `#!/bin/bash
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
CWD=$(echo "$INPUT" | jq -r '.cwd')

echo "CLAUDE_SESSION_ID: $SESSION_ID"
echo "CLAUDE_WORKING_DIR: $CWD"

exit 0
`;

const HANDOFF_SCRIPT_CONTENT = `#!/bin/bash
SESSION_ID=$1
CWD=$2

if [ -z "$SESSION_ID" ]; then
  echo "Usage: openacp-handoff.sh <session_id> [cwd]"
  exit 1
fi

openacp adopt claude "$SESSION_ID" \${CWD:+--cwd "$CWD"}
`;

const HANDOFF_COMMAND_CONTENT = `---
description: Transfer current session to OpenACP (Telegram)
---

Look at the context injected at the start of this message to find
CLAUDE_SESSION_ID and CLAUDE_WORKING_DIR, then run:

bash ~/.claude/hooks/openacp-handoff.sh <CLAUDE_SESSION_ID> <CLAUDE_WORKING_DIR>
`;

const HOOK_MARKER = "openacp-inject-session.sh";

function mergeClaudeSettings(): void {
  let settings: Record<string, unknown> = {};

  if (existsSync(SETTINGS_FILE)) {
    const raw = readFileSync(SETTINGS_FILE, "utf-8");
    writeFileSync(`${SETTINGS_FILE}.bak`, raw);
    settings = JSON.parse(raw);
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  settings.hooks = hooks;

  const userPromptSubmit = (hooks.UserPromptSubmit ?? []) as Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
  hooks.UserPromptSubmit = userPromptSubmit;

  const alreadyInstalled = userPromptSubmit.some((group) =>
    group.hooks?.some((h) => h.command?.includes(HOOK_MARKER)),
  );

  if (!alreadyInstalled) {
    userPromptSubmit.push({
      hooks: [
        {
          type: "command",
          command: INJECT_HOOK_FILE,
        },
      ],
    });
  }

  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
}

function removeClaudeSettings(): void {
  if (!existsSync(SETTINGS_FILE)) return;

  const raw = readFileSync(SETTINGS_FILE, "utf-8");
  const settings = JSON.parse(raw);

  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks?.UserPromptSubmit) return;

  hooks.UserPromptSubmit = (hooks.UserPromptSubmit as Array<{ hooks?: Array<{ command?: string }> }>).filter(
    (group) => !group.hooks?.some((h) => h.command?.includes("openacp-")),
  );

  if (hooks.UserPromptSubmit.length === 0) {
    delete hooks.UserPromptSubmit;
  }

  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
}

const claudeHandoffItem: IntegrationItem = {
  id: "handoff",
  name: "Handoff",
  description: "Transfer sessions between terminal and Telegram",

  isInstalled(): boolean {
    return (
      existsSync(INJECT_HOOK_FILE) &&
      existsSync(HANDOFF_SCRIPT_FILE) &&
      existsSync(HANDOFF_COMMAND_FILE)
    );
  },

  async install(): Promise<IntegrationResult> {
    const logs: string[] = [];
    try {
      mkdirSync(HOOKS_DIR, { recursive: true });
      mkdirSync(COMMANDS_DIR, { recursive: true });

      writeFileSync(INJECT_HOOK_FILE, INJECT_HOOK_CONTENT);
      chmodSync(INJECT_HOOK_FILE, 0o755);
      logs.push(`Created ${INJECT_HOOK_FILE}`);

      writeFileSync(HANDOFF_SCRIPT_FILE, HANDOFF_SCRIPT_CONTENT);
      chmodSync(HANDOFF_SCRIPT_FILE, 0o755);
      logs.push(`Created ${HANDOFF_SCRIPT_FILE}`);

      writeFileSync(HANDOFF_COMMAND_FILE, HANDOFF_COMMAND_CONTENT);
      logs.push(`Created ${HANDOFF_COMMAND_FILE}`);

      mergeClaudeSettings();
      logs.push(`Updated ${SETTINGS_FILE}`);

      return { success: true, logs };
    } catch (err) {
      logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return { success: false, logs };
    }
  },

  async uninstall(): Promise<IntegrationResult> {
    const logs: string[] = [];
    try {
      for (const file of [INJECT_HOOK_FILE, HANDOFF_SCRIPT_FILE, HANDOFF_COMMAND_FILE]) {
        if (existsSync(file)) {
          unlinkSync(file);
          logs.push(`Removed ${file}`);
        }
      }

      removeClaudeSettings();
      logs.push(`Updated ${SETTINGS_FILE}`);

      return { success: true, logs };
    } catch (err) {
      logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return { success: false, logs };
    }
  },
};

const claudeIntegration: AgentIntegration = {
  items: [claudeHandoffItem],
};

// --- Registry ---

const integrations: Record<string, AgentIntegration> = {
  claude: claudeIntegration,
};

export function getIntegration(agentName: string): AgentIntegration | undefined {
  return integrations[agentName];
}

export function listIntegrations(): string[] {
  return Object.keys(integrations);
}
