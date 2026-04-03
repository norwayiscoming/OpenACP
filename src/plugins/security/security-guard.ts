export interface SecurityConfig {
  allowedUserIds: string[];
  maxConcurrentSessions: number;
}

export class SecurityGuard {
  constructor(
    private getSecurityConfig: () => Promise<SecurityConfig>,
    private sessionManager: { listSessions(): Array<{ status: string }> },
  ) {}

  async checkAccess(message: { userId: string | number }):
    Promise<{ allowed: true } | { allowed: false; reason: string }>
  {
    const config = await this.getSecurityConfig();
    const allowedIds = config.allowedUserIds ?? [];
    const maxSessions = config.maxConcurrentSessions ?? 20;

    if (allowedIds.length > 0) {
      const userId = String(message.userId);
      if (!allowedIds.includes(userId)) {
        return { allowed: false, reason: "Unauthorized user" };
      }
    }
    const active = this.sessionManager.listSessions()
      .filter(s => s.status === "active" || s.status === "initializing");
    if (active.length >= maxSessions) {
      return { allowed: false, reason: `Session limit reached (${maxSessions})` };
    }
    return { allowed: true };
  }
}
