import securityPlugin from './security/index.js'
import fileServicePlugin from './file-service/index.js'
import contextPlugin from './context/index.js'
import usagePlugin from './usage/index.js'
import speechPlugin from './speech/index.js'
import notificationsPlugin from './notifications/index.js'
import tunnelPlugin from './tunnel/index.js'
import apiServerPlugin from './api-server/index.js'
import telegramPlugin from './telegram/index.js'
import discordPlugin from './discord/index.js'
import slackPlugin from './slack/index.js'

export const builtInPlugins = [
  securityPlugin,
  fileServicePlugin,
  contextPlugin,
  usagePlugin,
  speechPlugin,
  notificationsPlugin,
  tunnelPlugin,
  apiServerPlugin,
  telegramPlugin,
  discordPlugin,
  slackPlugin,
]
