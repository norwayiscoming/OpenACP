/**
 * All built-in plugins: services, infrastructure, and adapters.
 * Booted by LifecycleManager in dependency order.
 * Adapter plugins depend on service plugins, so they boot last.
 */
import securityPlugin from './security/index.js'
import fileServicePlugin from './file-service/index.js'
import contextPlugin from './context/index.js'
import speechPlugin from './speech/index.js'
import notificationsPlugin from './notifications/index.js'
import tunnelPlugin from './tunnel/index.js'
import apiServerPlugin from './api-server/index.js'
import telegramPlugin from './telegram/index.js'
import slackPlugin from './slack/index.js'

export const corePlugins = [
  // Service plugins (no adapter dependencies)
  securityPlugin,
  fileServicePlugin,
  contextPlugin,
  speechPlugin,
  notificationsPlugin,
  // Infrastructure plugins
  tunnelPlugin,
  apiServerPlugin,
  // Adapter plugins (depend on security, notifications, etc.)
  telegramPlugin,
  slackPlugin,
]
