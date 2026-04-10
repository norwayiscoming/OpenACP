import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { InstanceRegistry, readIdFromConfig } from '../../core/instance/instance-registry.js'
import { getGlobalRoot } from '../../core/instance/instance-context.js'
import { initInstanceFiles } from '../../core/instance/instance-init.js'
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

export async function cmdInstances(args: string[] = [], parentFlags?: { dir?: string; from?: string; name?: string }): Promise<void> {
  if (wantsHelp(args)) {
    printInstancesHelp()
    return
  }

  const sub = args[0]
  const subArgs = args.slice(1)

  // Re-inject flags that were consumed by top-level parser
  if (parentFlags) {
    if (parentFlags.dir && !subArgs.includes('--dir')) subArgs.push('--dir', parentFlags.dir)
    if (parentFlags.from && !subArgs.includes('--from')) subArgs.push('--from', parentFlags.from)
    if (parentFlags.name && !subArgs.includes('--name')) subArgs.push('--name', parentFlags.name)
  }

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

  const resolvedDir = path.resolve(rawDir!.replace(/^~/, os.homedir()))
  const instanceRoot = path.join(resolvedDir, '.openacp')

  const registryPath = path.join(getGlobalRoot(), 'instances.json')
  const registry = new InstanceRegistry(registryPath)
  registry.load()

  // Case: .openacp already exists
  if (fs.existsSync(instanceRoot)) {
    if (rawFrom) {
      if (json) jsonError(ErrorCodes.ALREADY_EXISTS, `Instance already exists at ${resolvedDir} — cannot use --from on an existing instance`)
      console.error(`Error: Instance already exists at ${resolvedDir}. Remove it first to clone from another instance.`)
      process.exit(1)
    }

    // Resolve id from config.json (source of truth) + registry. Reconciles any mismatch.
    const { id, registryUpdated } = registry.resolveId(instanceRoot)

    // Write id into config.json if missing; apply --name if provided
    initInstanceFiles(instanceRoot, { mergeExisting: true, id, instanceName })

    if (registryUpdated) registry.save()

    if (!json) console.warn(`Warning: Instance already exists at ${resolvedDir} (id: ${id})`)
    await outputInstance(json, { id, root: instanceRoot })
    return
  }

  // .openacp does NOT exist — remove any orphaned registry entry pointing here,
  // then proceed to create. The entry is stale: .openacp was deleted externally.
  const orphaned = registry.getByRoot(instanceRoot)
  if (orphaned) {
    registry.remove(orphaned.id)
    registry.save()
    if (!json) console.warn(`Warning: Removed stale registry entry for ${resolvedDir} (id: ${orphaned.id}) — .openacp was deleted. Creating new instance.`)
  }

  // Case: create new
  const name = instanceName ?? `openacp-${registry.list().length + 1}`
  const id = randomUUID()

  if (rawFrom) {
    const fromRoot = path.join(path.resolve(rawFrom.replace(/^~/, os.homedir())), '.openacp')
    if (!fs.existsSync(path.join(fromRoot, 'config.json'))) {
      console.error(`Error: No OpenACP instance found at ${rawFrom}`)
      process.exit(1)
    }
    fs.mkdirSync(instanceRoot, { recursive: true })
    const { copyInstance } = await import('../../core/instance/instance-copy.js')
    await copyInstance(fromRoot, instanceRoot, {})
    // copyInstance strips id — write the new id and instance name in one pass
    initInstanceFiles(instanceRoot, { mergeExisting: true, id, instanceName: name })
  } else {
    const agents = agent ? [agent] : undefined
    initInstanceFiles(instanceRoot, { agents, instanceName: name, id })
    if (!noInteractive && process.stdin.isTTY) {
      console.log(`Instance created at ${resolvedDir}. Run 'openacp setup' inside that directory to configure it.`)
    }
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
