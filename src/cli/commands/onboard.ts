import * as path from 'node:path'
import * as os from 'node:os'

export async function cmdOnboard(): Promise<void> {
  const { ConfigManager } = await import('../../core/config/config.js')
  const { SettingsManager } = await import('../../core/plugin/settings-manager.js')
  const { PluginRegistry } = await import('../../core/plugin/plugin-registry.js')

  // Temporary — will be replaced by InstanceContext
  const OPENACP_DIR = path.join(os.homedir(), '.openacp')
  const PLUGINS_DATA_DIR = path.join(OPENACP_DIR, 'plugins', 'data')
  const REGISTRY_PATH = path.join(OPENACP_DIR, 'plugins.json')

  const cm = new ConfigManager()
  const settingsManager = new SettingsManager(PLUGINS_DATA_DIR)
  const pluginRegistry = new PluginRegistry(REGISTRY_PATH)
  await pluginRegistry.load()

  if (await cm.exists()) {
    const { runReconfigure } = await import('../../core/setup/index.js')
    await runReconfigure(cm)
  } else {
    const { runSetup } = await import('../../core/setup/index.js')
    await runSetup(cm, { skipRunMode: true, settingsManager, pluginRegistry })
  }
}
