import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Config } from './config.js'

export interface ConfigFieldDef {
  path: string
  displayName: string
  group: string
  type: 'toggle' | 'select' | 'number' | 'string'
  options?: string[] | ((config: Config) => string[])
  scope: 'safe' | 'sensitive'
  hotReload: boolean
}

export const CONFIG_REGISTRY: ConfigFieldDef[] = [
  {
    path: 'defaultAgent',
    displayName: 'Default Agent',
    group: 'agent',
    type: 'select',
    options: (config) => {
      try {
        const agentsPath = path.join(os.homedir(), ".openacp", "agents.json");
        if (fs.existsSync(agentsPath)) {
          const data = JSON.parse(fs.readFileSync(agentsPath, "utf-8"));
          return Object.keys(data.installed ?? {});
        }
      } catch { /* fallback */ }
      return Object.keys(config.agents ?? {});
    },
    scope: 'safe',
    hotReload: true,
  },
  {
    path: 'logging.level',
    displayName: 'Log Level',
    group: 'logging',
    type: 'select',
    options: ['silent', 'debug', 'info', 'warn', 'error', 'fatal'],
    scope: 'safe',
    hotReload: true,
  },
  {
    path: 'tunnel.enabled',
    displayName: 'Tunnel',
    group: 'tunnel',
    type: 'toggle',
    scope: 'safe',
    hotReload: false,
  },
  {
    path: 'security.maxConcurrentSessions',
    displayName: 'Max Concurrent Sessions',
    group: 'security',
    type: 'number',
    scope: 'safe',
    hotReload: true,
  },
  {
    path: 'security.sessionTimeoutMinutes',
    displayName: 'Session Timeout (min)',
    group: 'security',
    type: 'number',
    scope: 'safe',
    hotReload: true,
  },
  {
    path: 'workspace.baseDir',
    displayName: 'Workspace Directory',
    group: 'workspace',
    type: 'string',
    scope: 'safe',
    hotReload: true,
  },
  {
    path: 'sessionStore.ttlDays',
    displayName: 'Session Store TTL (days)',
    group: 'storage',
    type: 'number',
    scope: 'safe',
    hotReload: true,
  },
  {
    path: 'speech.stt.provider',
    displayName: 'Speech to Text',
    group: 'speech',
    type: 'select',
    options: ['groq'],
    scope: 'safe',
    hotReload: true,
  },
  {
    path: 'speech.stt.apiKey',
    displayName: 'STT API Key',
    group: 'speech',
    type: 'string',
    scope: 'sensitive',
    hotReload: true,
  },
  {
    path: 'speech.tts.provider',
    displayName: 'Text to Speech',
    group: 'speech',
    type: 'select',
    options: ['edge-tts'],
    scope: 'safe',
    hotReload: true,
  },
  {
    path: 'speech.tts.providers.edge-tts.voice',
    displayName: 'Edge TTS Voice',
    group: 'speech',
    type: 'select',
    options: [
      'en-US-AriaNeural', 'en-US-GuyNeural', 'en-US-JennyNeural',
      'en-GB-SoniaNeural', 'en-AU-NatashaNeural',
      'vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural',
      'zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural',
      'ja-JP-NanamiNeural', 'ja-JP-KeitaNeural',
      'ko-KR-SunHiNeural', 'ko-KR-InJoonNeural',
      'es-ES-ElviraNeural', 'fr-FR-DeniseNeural',
      'de-DE-KatjaNeural', 'pt-BR-FranciscaNeural',
      'hi-IN-SwaraNeural', 'ar-SA-ZariyahNeural',
    ],
    scope: 'safe',
    hotReload: true,
  },
]

export function getFieldDef(path: string): ConfigFieldDef | undefined {
  return CONFIG_REGISTRY.find((f) => f.path === path)
}

export function getSafeFields(): ConfigFieldDef[] {
  return CONFIG_REGISTRY.filter((f) => f.scope === 'safe')
}

export function isHotReloadable(path: string): boolean {
  const def = getFieldDef(path)
  return def?.hotReload ?? false
}

export function resolveOptions(def: ConfigFieldDef, config: Config): string[] | undefined {
  if (!def.options) return undefined
  return typeof def.options === 'function' ? def.options(config) : def.options
}

export function getConfigValue(config: Config, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = config
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return current
}
