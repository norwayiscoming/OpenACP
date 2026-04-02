import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { InstanceRegistry } from '../../core/instance/instance-registry.js'
import { getGlobalRoot, generateSlug } from '../../core/instance/instance-context.js'
import { readInstanceInfo } from './status.js'
import { isJsonMode, jsonSuccess, jsonError, muteForJson, ErrorCodes } from '../output.js'
import { wantsHelp } from './helpers.js'

export interface InstanceListEntry {
  id: string
  name: string | null
  directory: string
  root: string
  status: 'running' | 'stopped'
  port: number | null
}

export async function buildInstanceListEntries(): Promise<InstanceListEntry[]> {
  const registryPath = path.join(getGlobalRoot(), 'instances.json')
  const registry = new InstanceRegistry(registryPath)
  registry.load()
  return registry.list().map(entry => {
    const info = readInstanceInfo(entry.root)
    return {
      id: entry.id,
      name: info.name,
      directory: path.dirname(entry.root),
      root: entry.root,
      status: (info.pid ? 'running' : 'stopped') as 'running' | 'stopped',
      port: info.apiPort,
    }
  })
}

export async function cmdInstances(args: string[] = []): Promise<void> {
  if (wantsHelp(args)) {
    printInstancesHelp()
    return
  }

  const sub = args[0]
  const subArgs = args.slice(1)

  if (!sub || sub === 'list') return cmdInstancesList(subArgs)
  if (sub === 'create') return cmdInstancesCreate(subArgs)

  console.error(`Unknown subcommand: instances ${sub}`)
  printInstancesHelp()
  process.exit(1)
}

function printInstancesHelp(): void {
  console.log(`
\x1b[1mopenacp instances\x1b[0m — Manage OpenACP instances

\x1b[1mSubcommands:\x1b[0m
  list      List all registered instances
  create    Create or register an instance

\x1b[1mOptions:\x1b[0m
  --json    Output as JSON
`)
}

async function cmdInstancesList(args: string[]): Promise<void> {
  const json = isJsonMode(args)
  if (json) await muteForJson()

  const entries = await buildInstanceListEntries()

  if (json) {
    jsonSuccess(entries)
    return
  }

  if (entries.length === 0) {
    console.log('No instances registered.')
    return
  }

  console.log('')
  console.log('  Status     ID               Name             Directory')
  console.log('  ' + '─'.repeat(70))
  for (const e of entries) {
    const status = e.status === 'running' ? '● running' : '○ stopped'
    const port = e.port ? `:${e.port}` : '—'
    const dir = e.directory.replace(os.homedir(), '~')
    const name = (e.name ?? e.id).padEnd(16)
    console.log(`  ${status.padEnd(10)} ${e.id.padEnd(16)} ${name} ${dir}  ${port}`)
  }
  console.log('')
}

export async function cmdInstancesCreate(args: string[]): Promise<void> {
  const json = isJsonMode(args)
  if (json) await muteForJson()

  // Parse flags
  const dirIdx = args.indexOf('--dir')
  const rawDir = dirIdx !== -1 ? args[dirIdx + 1] : undefined
  if (!rawDir) {
    if (json) jsonError(ErrorCodes.MISSING_ARGUMENT, '--dir is required')
    console.error('Error: --dir is required')
    process.exit(1)
  }

  const fromIdx = args.indexOf('--from')
  const rawFrom = fromIdx !== -1 ? args[fromIdx + 1] : undefined
  const nameIdx = args.indexOf('--name')
  const instanceName = nameIdx !== -1 ? args[nameIdx + 1] : undefined
  const agentIdx = args.indexOf('--agent')
  const agent = agentIdx !== -1 ? args[agentIdx + 1] : undefined
  const noInteractive = args.includes('--no-interactive')

  // Resolve absolute paths
  const resolvedDir = path.resolve(rawDir.replace(/^~/, os.homedir()))
  const instanceRoot = path.join(resolvedDir, '.openacp')

  const registryPath = path.join(getGlobalRoot(), 'instances.json')
  const registry = new InstanceRegistry(registryPath)
  registry.load()

  // Case: .openacp already exists
  if (fs.existsSync(instanceRoot)) {
    const existing = registry.getByRoot(instanceRoot)
    if (existing) {
      if (json) jsonError(ErrorCodes.UNKNOWN_ERROR, `Instance already exists at ${resolvedDir} (id: ${existing.id})`)
      console.error(`Error: Instance already exists at ${resolvedDir} (id: ${existing.id})`)
      process.exit(1)
    }
    // .openacp exists but not registered — register it
    const configPath = path.join(instanceRoot, 'config.json')
    let name = path.basename(resolvedDir)
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      name = config.instanceName ?? name
    } catch {}
    const id = registry.uniqueId(generateSlug(name))
    registry.register(id, instanceRoot)
    registry.save()
    await outputInstance(json, { id, root: instanceRoot })
    return
  }

  // Case: create new
  const name = instanceName ?? `openacp-${registry.list().length + 1}`
  const id = registry.uniqueId(generateSlug(name))

  if (rawFrom) {
    // Clone from existing instance using copyInstance
    const fromRoot = path.join(path.resolve(rawFrom.replace(/^~/, os.homedir())), '.openacp')
    if (!fs.existsSync(path.join(fromRoot, 'config.json'))) {
      console.error(`Error: No OpenACP instance found at ${rawFrom}`)
      process.exit(1)
    }
    fs.mkdirSync(instanceRoot, { recursive: true })
    const { copyInstance } = await import('../../core/instance/instance-copy.js')
    await copyInstance(fromRoot, instanceRoot, {})
    // Write instanceName into config
    const configPath = path.join(instanceRoot, 'config.json')
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      config.instanceName = name
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    } catch {}
  } else if (noInteractive || !process.stdin.isTTY) {
    // Minimal config for non-interactive mode
    fs.mkdirSync(instanceRoot, { recursive: true })
    const config: Record<string, unknown> = { instanceName: name, runMode: 'daemon' }
    if (agent) config.defaultAgent = agent
    fs.writeFileSync(path.join(instanceRoot, 'config.json'), JSON.stringify(config, null, 2))
    fs.writeFileSync(path.join(instanceRoot, 'plugins.json'), JSON.stringify({ version: 1, installed: {} }, null, 2))
  } else {
    // Interactive wizard — requires plugin system; fall back to minimal config
    fs.mkdirSync(instanceRoot, { recursive: true })
    const config: Record<string, unknown> = { instanceName: name, runMode: 'daemon' }
    if (agent) config.defaultAgent = agent
    fs.writeFileSync(path.join(instanceRoot, 'config.json'), JSON.stringify(config, null, 2))
    fs.writeFileSync(path.join(instanceRoot, 'plugins.json'), JSON.stringify({ version: 1, installed: {} }, null, 2))
    console.log(`Instance created at ${resolvedDir}. Run 'openacp setup' inside that directory to configure it.`)
  }

  registry.register(id, instanceRoot)
  registry.save()
  await outputInstance(json, { id, root: instanceRoot })
}

async function outputInstance(json: boolean, { id, root }: { id: string; root: string }): Promise<void> {
  const info = readInstanceInfo(root)
  const entry: InstanceListEntry = {
    id,
    name: info.name,
    directory: path.dirname(root),
    root,
    status: (info.pid ? 'running' : 'stopped') as 'running' | 'stopped',
    port: info.apiPort,
  }
  if (json) {
    jsonSuccess(entry)
    return
  }
  console.log(`Instance created: ${info.name ?? id} at ${path.dirname(root)}`)
}
