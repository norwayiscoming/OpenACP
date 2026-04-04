import { wantsHelp } from './helpers.js'

export async function cmdReset(args: string[] = [], instanceRoot?: string): Promise<void> {
  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp reset\x1b[0m — Re-run setup wizard

\x1b[1mUsage:\x1b[0m
  openacp reset

Deletes all OpenACP data in the instance directory and allows you to
start fresh with the setup wizard. The daemon must be stopped first.

\x1b[1m\x1b[31mThis is destructive\x1b[0m — config, plugins, agent data will be removed.
`)
    return
  }
  const os = await import('node:os')
  const path = await import('node:path')
  const root = instanceRoot ?? path.join(os.homedir(), '.openacp')

  const { getStatus, getPidPath } = await import('../daemon.js')
  const status = getStatus(getPidPath(root))
  if (status.running) {
    console.error('OpenACP is running. Stop it first: openacp stop')
    process.exit(1)
  }

  const clack = await import('@clack/prompts')
  const yes = await clack.confirm({
    message: `This will delete all OpenACP data (${root}). You will need to set up again. Continue?`,
    initialValue: false,
  })
  if (clack.isCancel(yes) || !yes) {
    console.log('Aborted.')
    return
  }

  const { uninstallAutoStart } = await import('../autostart.js')
  uninstallAutoStart()

  const fs = await import('node:fs')
  fs.rmSync(root, { recursive: true, force: true })

  console.log('Reset complete. Run `openacp` to set up again.')
}
