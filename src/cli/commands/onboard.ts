import * as path from 'node:path'

/**
 * `openacp onboard` — Re-run the configuration wizard.
 *
 * If the instance already has a config, runs `runReconfigure` (update existing settings).
 * Otherwise runs the full `runSetup` with skipRunMode=true (preserves the current
 * run mode rather than prompting again).
 */
export async function cmdOnboard(instanceRoot?: string): Promise<void> {
  const { ConfigManager } = await import('../../core/config/config.js')
  const { SettingsManager } = await import('../../core/plugin/settings-manager.js')
  const { PluginRegistry } = await import('../../core/plugin/plugin-registry.js')
  const OPENACP_DIR = instanceRoot!
  const PLUGINS_DATA_DIR = path.join(OPENACP_DIR, 'plugins', 'data')
  const REGISTRY_PATH = path.join(OPENACP_DIR, 'plugins.json')

  const cm = new ConfigManager(path.join(OPENACP_DIR, 'config.json'))
  const settingsManager = new SettingsManager(PLUGINS_DATA_DIR)
  const pluginRegistry = new PluginRegistry(REGISTRY_PATH)
  await pluginRegistry.load()

  if (await cm.exists()) {
    const { runReconfigure } = await import('../../core/setup/index.js')
    await runReconfigure(cm, settingsManager)
  } else {
    const { runSetup } = await import('../../core/setup/index.js')
    await runSetup(cm, { skipRunMode: true, settingsManager, pluginRegistry, instanceRoot: OPENACP_DIR })
  }
}
