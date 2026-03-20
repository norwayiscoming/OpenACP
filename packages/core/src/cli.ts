#!/usr/bin/env node

import { installPlugin, uninstallPlugin, listPlugins } from './plugin-manager.js'

const args = process.argv.slice(2)
const command = args[0]

function printHelp(): void {
  console.log(`
OpenACP - Self-hosted bridge for AI coding agents

Usage:
  openacp                              Start the server
  openacp install <package>            Install a plugin adapter
  openacp uninstall <package>          Uninstall a plugin adapter
  openacp plugins                      List installed plugins
  openacp --version                    Show version
  openacp --help                       Show this help

Install:
  npm install -g @openacp/cli

Examples:
  openacp
  openacp install @openacp/adapter-discord
  openacp uninstall @openacp/adapter-discord
`)
}

async function main() {
  if (command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === '--version' || command === '-v') {
    // In published build: read version from own package.json via createRequire
    // In dev: fallback to 'dev'
    try {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const pkg = require('../package.json')
      console.log(`openacp v${pkg.version}`)
    } catch {
      console.log('openacp v0.0.0-dev')
    }
    return
  }

  if (command === 'install') {
    const pkg = args[1]
    if (!pkg) {
      console.error('Usage: openacp install <package>')
      process.exit(1)
    }
    installPlugin(pkg)
    return
  }

  if (command === 'uninstall') {
    const pkg = args[1]
    if (!pkg) {
      console.error('Usage: openacp uninstall <package>')
      process.exit(1)
    }
    uninstallPlugin(pkg)
    return
  }

  if (command === 'plugins') {
    const plugins = listPlugins()
    const entries = Object.entries(plugins)
    if (entries.length === 0) {
      console.log('No plugins installed.')
    } else {
      console.log('Installed plugins:')
      for (const [name, version] of entries) {
        console.log(`  ${name}@${version}`)
      }
    }
    return
  }

  // Default: start server
  if (command && !command.startsWith('-')) {
    console.error(`Unknown command: ${command}`)
    printHelp()
    process.exit(1)
  }

  // Import and run server start
  const { startServer } = await import('./main.js')
  await startServer()
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
