import type { IChannelAdapter } from '../../core/channel.js'
import type { NotificationMessage } from '../../core/types.js'

/**
 * Routes cross-session notifications to the appropriate channel adapter.
 *
 * Notifications are triggered by `SessionBridge` when a session completes,
 * errors, or hits a budget threshold. Unlike regular messages, notifications
 * are not tied to a specific outgoing message stream — they are pushed to the
 * channel that owns the session (identified by `channelId` on the session).
 *
 * The adapters Map is the live registry maintained by `OpenACPCore`. Holding a
 * reference to the Map (rather than a snapshot) ensures that adapters registered
 * after this service is created are still reachable.
 */
export class NotificationManager {
  constructor(private adapters: Map<string, IChannelAdapter>) {}

  /**
   * Send a notification to a specific channel adapter.
   *
   * Failures are swallowed — notifications are best-effort and must not crash
   * the session or caller (e.g. on session completion).
   */
  async notify(channelId: string, notification: NotificationMessage): Promise<void> {
    const adapter = this.adapters.get(channelId)
    if (!adapter) return
    try {
      await adapter.sendNotification(notification)
    } catch {
      // Don't let notification failures crash the caller
    }
  }

  /**
   * Broadcast a notification to every registered adapter.
   *
   * Used for system-wide alerts (e.g. global budget exhausted). Each adapter
   * failure is isolated so one broken adapter cannot block the rest.
   */
  async notifyAll(notification: NotificationMessage): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.sendNotification(notification)
      } catch {
        // Continue to next adapter
      }
    }
  }
}
