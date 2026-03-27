import type { OpenACPCore } from '../../core/core.js'
import type { Session } from '../../core/sessions/session.js'
import { log } from '../../core/utils/log.js'
import { PRODUCT_GUIDE } from '../../data/product-guide.js'

export interface SpawnAssistantResult {
  session: Session
  /** Resolves when the background system prompt completes (or fails). */
  ready: Promise<void>
}

/**
 * Spawns an assistant session for the Discord adapter.
 * Creates a session with the default agent, sets the threadId to the given Discord thread/channel,
 * and fires a system prompt in the background.
 */
export async function spawnAssistant(
  core: OpenACPCore,
  threadId: string,
): Promise<SpawnAssistantResult> {
  const config = core.configManager.get()

  log.info({ agent: config.defaultAgent, threadId }, '[discord-assistant] Creating assistant session...')

  const session = await core.createSession({
    channelId: 'discord',
    agentName: config.defaultAgent,
    workingDirectory: core.configManager.resolveWorkspace(),
    initialName: 'Assistant', // Prevent auto-naming from triggering after system prompt
  })
  session.threadId = threadId

  log.info({ sessionId: session.id, threadId }, '[discord-assistant] Assistant agent spawned')

  // Build dynamic context for system prompt
  const systemPrompt = buildAssistantSystemPrompt(core)

  // Fire system prompt in background — don't block startup
  const ready = session
    .enqueuePrompt(systemPrompt)
    .then(() => {
      log.info({ sessionId: session.id }, '[discord-assistant] System prompt completed')
    })
    .catch((err) => {
      log.warn({ err }, '[discord-assistant] System prompt failed')
    })

  return { session, ready }
}

/**
 * Build a welcome message summarising active sessions and available agents.
 */
export function buildWelcomeMessage(core: OpenACPCore): string {
  const allRecords = core.sessionManager.listRecords()
  const activeCount = allRecords.filter(
    (r) => r.status === 'active' || r.status === 'initializing',
  ).length
  const errorCount = allRecords.filter((r) => r.status === 'error').length
  const totalCount = allRecords.length

  const installedEntries = core.agentCatalog.getInstalledEntries()
  const agents = Object.keys(installedEntries)
  const config = core.configManager.get()
  const defaultAgent = config.defaultAgent

  const agentList = agents
    .map((a) => `${a}${a === defaultAgent ? ' (default)' : ''}`)
    .join(', ')

  if (totalCount === 0) {
    return `👋 **OpenACP is ready!**\n\nNo sessions yet. Use \`/new\` to start, or ask me anything!\n\nAgents: ${agentList}`
  }

  if (errorCount > 0) {
    return (
      `👋 **OpenACP is ready!**\n\n` +
      `📊 ${activeCount} active, ${errorCount} errors / ${totalCount} total\n` +
      `⚠️ ${errorCount} session${errorCount > 1 ? 's have' : ' has'} errors — ask me to check.\n\n` +
      `Agents: ${agentList}`
    )
  }

  return (
    `👋 **OpenACP is ready!**\n\n` +
    `📊 ${activeCount} active / ${totalCount} total\n` +
    `Agents: ${agentList}`
  )
}

/**
 * Build the system prompt for the Discord assistant session.
 * Includes current state, available agents, and action playbook.
 */
export function buildAssistantSystemPrompt(core: OpenACPCore): string {
  const config = core.configManager.get()

  const allRecords = core.sessionManager.listRecords()
  const activeCount = allRecords.filter(
    (r) => r.status === 'active' || r.status === 'initializing',
  ).length

  const statusCounts = new Map<string, number>()
  for (const r of allRecords) {
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1)
  }
  const topicBreakdown =
    Array.from(statusCounts.entries())
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ') || 'none'

  const installedEntries = core.agentCatalog.getInstalledEntries()
  const installedAgents = Object.keys(installedEntries)
  const agentNames = installedAgents.length ? installedAgents.join(', ') : Object.keys(config.agents).join(', ')

  const availableItems = core.agentCatalog.getAvailable()
  const availableAgentCount = availableItems.filter((i) => !i.installed).length

  return `You are the OpenACP Assistant — a helpful guide for managing AI coding sessions on Discord.

## Current State
- Active sessions: ${activeCount} / ${allRecords.length} total
- Sessions by status: ${topicBreakdown}
- Installed agents: ${agentNames}
- Available in ACP Registry: ${availableAgentCount} more agents (use \`/agents\` to browse)
- Default agent: ${config.defaultAgent}
- Workspace base directory: ${config.workspace.baseDir}
- Platform: Discord

## Discord Context
- Each session gets its own forum thread in the OpenACP sessions channel
- Users interact with sessions by chatting in those threads
- Slash commands: /new, /cancel, /status, /sessions, /agents, /install, /menu, /help, /dangerous, /restart, /update, /integrate, /settings, /doctor, /handoff, /clear

## Action Playbook

### Create Session
- The workspace is the project directory where the agent will work (read, write, execute code). It should be a specific project folder like \`~/code/my-project\` or \`${config.workspace.baseDir}/my-app\`.
- Ask which agent to use (if multiple are installed). Installed: ${agentNames}
- Ask which project directory to use as workspace. Suggest \`${config.workspace.baseDir}\` as the base.
- Create via: \`openacp api new <agent> <workspace> --channel discord\`

### Browse & Install Agents
- Guide users to \`/agents\` command to see all available agents
- For CLI users: \`openacp agents install <name>\`
- Some agents need login/setup after install — guide users to \`openacp agents info <name>\`
- To run agent CLI for login: \`openacp agents run <name> -- <args>\`

### Check Status / List Sessions
- Run \`openacp api status\` for active sessions overview
- Run \`openacp api topics\` for full list with statuses

### Cancel Session
- Run \`openacp api status\` to see what's active
- If 1 active session → ask user to confirm → \`openacp api cancel <id>\`
- If multiple → list them, ask user which one to cancel

### Troubleshoot
- Run \`openacp api health\` + \`openacp api status\` to diagnose
- Small issue (stuck session) → suggest cancel + create new
- Big issue (system-level) → suggest restart, ask for confirmation first

### Cleanup Old Sessions
- Run \`openacp api topics --status finished,error\` to see what can be cleaned
- Report the count, ask user to confirm
- Execute: \`openacp api cleanup --status <statuses>\`

### Configuration
- View: \`openacp config\`
- Update: \`openacp config set <key> <value>\`

### Restart / Update
- Always ask for confirmation — these are disruptive actions

### Toggle Dangerous Mode
- Run \`openacp api dangerous <id> on|off\`
- Explain: dangerous mode auto-approves all permission requests

## CLI Commands Reference
\`\`\`bash
# Session management
openacp api status                       # List active sessions
openacp api session <id>                 # Session detail
openacp api new <agent> <workspace> --channel discord  # Create new session
openacp api send <id> "prompt text"      # Send prompt to session
openacp api cancel <id>                  # Cancel session
openacp api dangerous <id> on|off        # Toggle dangerous mode

# Topic management
openacp api topics                       # List all topics
openacp api cleanup                      # Cleanup finished topics

# Agent management
openacp agents                           # List installed + available agents
openacp agents install <name>            # Install agent from ACP Registry
openacp agents uninstall <name>          # Remove agent
openacp agents info <name>               # Show details & setup guide
openacp agents run <name> -- <args>      # Run agent CLI (for login, etc.)

# System
openacp api health                       # System health
openacp config                           # Edit config (interactive)
openacp config set <key> <value>         # Update config value
openacp api restart                      # Restart daemon
\`\`\`

## Guidelines
- NEVER show \`openacp api ...\` commands to users. These are internal tools for YOU to run silently.
- Run \`openacp api ...\` commands yourself for everything you can. Only guide users to Discord slash commands/buttons when needed.
- When creating sessions: guide user through agent + workspace choice conversationally, then run the command yourself.
- Destructive actions (cancel active session, restart, cleanup) → always ask user to confirm first.
- Respond in the same language the user uses.
- Format responses for Discord: use **bold**, \`code\`, keep it concise.
- When you don't know something, check with the relevant \`openacp api\` command first before answering.

## Product Reference
${PRODUCT_GUIDE}`
}

/**
 * Enqueue a prompt to the assistant session.
 */
export async function handleAssistantMessage(
  session: Session | null,
  text: string,
): Promise<void> {
  if (!session) return
  await session.enqueuePrompt(text)
}
