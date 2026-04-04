import fs from 'node:fs'
import path from 'node:path'
import { wantsHelp } from './helpers.js'

export async function cmdDev(args: string[] = []): Promise<void> {
  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp dev\x1b[0m — Run OpenACP with a local plugin in development mode

\x1b[1mUsage:\x1b[0m
  openacp dev <plugin-path> [options]

\x1b[1mOptions:\x1b[0m
  --no-watch       Disable file watching (no hot-reload)
  --verbose        Enable verbose logging

\x1b[1mExamples:\x1b[0m
  openacp dev ./my-plugin
  openacp dev ../adapter-matrix --no-watch
  openacp dev ./my-plugin --verbose
`)
    return
  }

  // Parse args: first non-flag arg after 'dev' is plugin path
  const pluginPathArg = args.find(a => !a.startsWith('--'))
  const noWatch = args.includes('--no-watch')
  const verbose = args.includes('--verbose')

  if (!pluginPathArg) {
    console.error('Error: missing plugin path. Usage: openacp dev <plugin-path>')
    process.exit(1)
  }

  const pluginPath = path.resolve(pluginPathArg)

  if (!fs.existsSync(pluginPath)) {
    console.error(`Error: plugin path does not exist: ${pluginPath}`)
    process.exit(1)
  }

  const tsconfigPath = path.join(pluginPath, 'tsconfig.json')
  const hasTsconfig = fs.existsSync(tsconfigPath)

  // Initial TypeScript compile if tsconfig exists
  if (hasTsconfig) {
    console.log('Compiling plugin TypeScript...')
    const { execSync } = await import('node:child_process')
    try {
      execSync('npx tsc', { cwd: pluginPath, stdio: 'inherit' })
      console.log('Compilation complete.')
    } catch {
      console.error('TypeScript compilation failed. Fix errors and try again.')
      process.exit(1)
    }

    // Start tsc --watch in background if watching is enabled
    if (!noWatch) {
      const { spawn } = await import('node:child_process')
      const tscWatch = spawn('npx', ['tsc', '--watch', '--preserveWatchOutput'], {
        cwd: pluginPath,
        stdio: verbose ? 'inherit' : 'ignore',
      })
      tscWatch.unref()

      process.on('exit', () => {
        try { tscWatch.kill() } catch { /* ignore */ }
      })

      if (verbose) {
        console.log('Started tsc --watch for plugin')
      }
    }
  }

  // Set dev environment variables
  process.env.OPENACP_DEV_PLUGIN_PATH = pluginPath
  process.env.OPENACP_DEV_NO_WATCH = noWatch ? '1' : ''
  if (verbose) {
    process.env.OPENACP_DEBUG = '1'
  }
  process.env.OPENACP_DEV_LOOP = '1'

  // Start the server with dev plugin support
  const { startServer } = await import('../../main.js')
  await startServer({ devPluginPath: pluginPath, noWatch })
}
