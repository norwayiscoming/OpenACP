export const DEFAULT_ENV_WHITELIST = [
  "PATH", "HOME", "SHELL", "LANG", "LC_*", "TERM", "USER", "LOGNAME",
  "TMPDIR", "XDG_*", "NODE_ENV", "EDITOR",
  // Git
  "GIT_*", "SSH_AUTH_SOCK", "SSH_AGENT_PID",
  // Terminal rendering
  "COLORTERM", "FORCE_COLOR", "NO_COLOR", "TERM_PROGRAM", "HOSTNAME",
];

function matchesPattern(key: string, pattern: string): boolean {
  if (pattern.endsWith("*")) {
    return key.startsWith(pattern.slice(0, -1));
  }
  return key === pattern;
}

export function filterEnv(
  processEnv: Record<string, string | undefined>,
  agentEnv?: Record<string, string>,
  whitelist?: string[],
): Record<string, string> {
  const patterns = whitelist ?? DEFAULT_ENV_WHITELIST;
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    if (patterns.some((p) => matchesPattern(key, p))) {
      result[key] = value;
    }
  }

  if (agentEnv) {
    Object.assign(result, agentEnv);
  }

  return result;
}
