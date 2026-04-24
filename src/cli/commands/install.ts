import { wantsHelp } from './helpers.js'
import { isJsonMode } from '../output.js'
import { cmdPlugin } from './plugins.js'

/**
 * `openacp install` — Install an adapter plugin from npm.
 *
 * Delegates to `openacp plugin add` so that plugin lifecycle hooks (install,
 * onboard) are run and the plugin is registered in plugins.json.
 */
export async function cmdInstall(args: string[], instanceRoot?: string): Promise<void> {
  if (!isJsonMode(args) && wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp install\x1b[0m — Install a plugin adapter

\x1b[1mUsage:\x1b[0m
  openacp install <package>

\x1b[1mArguments:\x1b[0m
  <package>       npm package name (e.g. @openacp/discord-adapter)

Installs the plugin to the instance's plugins directory and runs its setup hook.
Equivalent to: openacp plugin add <package>

\x1b[1mOptions:\x1b[0m
  --json          Output result as JSON
  -h, --help      Show this help message

\x1b[1mExamples:\x1b[0m
  openacp install @openacp/discord-adapter
`)
    return
  }

  await cmdPlugin(['add', ...args], instanceRoot)
}
