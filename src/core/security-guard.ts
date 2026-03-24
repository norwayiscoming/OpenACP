import type { ConfigManager } from "./config.js";
import type { SessionManager } from "./session-manager.js";
import type { IncomingMessage } from "./types.js";

export class SecurityGuard {
  constructor(
    private configManager: ConfigManager,
    private sessionManager: SessionManager,
  ) {}

  checkAccess(message: IncomingMessage):
    | { allowed: true }
    | { allowed: false; reason: string }
  {
    const config = this.configManager.get();
    if (config.security.allowedUserIds.length > 0) {
      const userId = String(message.userId);
      if (!config.security.allowedUserIds.includes(userId)) {
        return { allowed: false, reason: "Unauthorized user" };
      }
    }
    const active = this.sessionManager.listSessions()
      .filter(s => s.status === "active" || s.status === "initializing");
    if (active.length >= config.security.maxConcurrentSessions) {
      return { allowed: false, reason: `Session limit reached (${config.security.maxConcurrentSessions})` };
    }
    return { allowed: true };
  }
}
