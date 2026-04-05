import path from 'node:path'
import type { InstallContext } from './types.js'
import type { SettingsManager } from './settings-manager.js'
import { createTerminalIO } from './terminal-io.js'
import { log as rootLog } from '../utils/log.js'

export interface CreateInstallContextOpts {
  pluginName: string
  settingsManager: SettingsManager
  basePath: string
  instanceRoot?: string
}

export function createInstallContext(opts: CreateInstallContextOpts): InstallContext {
  const { pluginName, settingsManager, basePath, instanceRoot } = opts
  const dataDir = path.join(basePath, pluginName, 'data')

  return {
    pluginName,
    terminal: createTerminalIO(),
    settings: settingsManager.createAPI(pluginName),
    dataDir,
    log: rootLog.child({ plugin: pluginName }),
    instanceRoot,
  }
}
