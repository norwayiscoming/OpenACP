import { wantsHelp } from './helpers.js'

export async function cmdAutostart(args: string[] = [], instanceRoot?: string): Promise<void> {
  const subcommand = args[0]

  if (!subcommand || wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp autostart\x1b[0m — Manage auto-start on login

\x1b[1mUsage:\x1b[0m
  openacp autostart install     Install LaunchAgent (macOS) or systemd unit (Linux)
  openacp autostart uninstall   Remove auto-start service
  openacp autostart status      Show whether auto-start is installed

\x1b[1mOptions:\x1b[0m
  -h, --help      Show this help message
`)
    return
  }

  const { installAutoStart, uninstallAutoStart, isAutoStartInstalled, isAutoStartSupported } = await import('../autostart.js')

  if (subcommand === 'status') {
    if (!isAutoStartSupported()) {
      console.log('Auto-start is not supported on this platform.')
      return
    }
    const installed = isAutoStartInstalled()
    console.log(`Auto-start: ${installed ? '\x1b[32minstalled\x1b[0m' : '\x1b[33mnot installed\x1b[0m'}`)
    return
  }

  if (subcommand === 'install') {
    if (!isAutoStartSupported()) {
      console.error('Auto-start is not supported on this platform.')
      process.exit(1)
    }
    const root = instanceRoot!
    const logDir = `${root}/logs`
    const result = installAutoStart(logDir, root)
    if (result.success) {
      console.log('\x1b[32m✓\x1b[0m Auto-start installed.')
    } else {
      console.error(`\x1b[31m✗\x1b[0m Failed to install auto-start: ${result.error}`)
      process.exit(1)
    }
    return
  }

  if (subcommand === 'uninstall') {
    const result = uninstallAutoStart()
    if (result.success) {
      console.log('\x1b[32m✓\x1b[0m Auto-start uninstalled.')
    } else {
      console.error(`\x1b[31m✗\x1b[0m Failed to uninstall auto-start: ${result.error}`)
      process.exit(1)
    }
    return
  }

  console.error(`Unknown subcommand: ${subcommand}. Run \`openacp autostart --help\` for usage.`)
  process.exit(1)
}
