import type { Bot, Context } from "grammy";
import type { OpenACPCore } from "../../../core/index.js";

// Domain modules
import { handleNew, handleNewChat, createSessionDirect } from './new-session.js'
import { handleCancel, handleStatus, handleTopics, handleArchive, handleArchiveConfirm, setupSessionCallbacks } from './session.js'
import { handleUpdate, handleRestart, handleTTS, handleVerbosity, handleOutputMode } from './admin.js'
import { handleMenu, handleHelp, handleClear, buildMenuKeyboard } from './menu.js'
import { handleAgents, handleInstall, handleAgentCallback } from "./agents.js";
import { handleIntegrate } from "./integrate.js";
import {
  handleResume,
  setupResumeCallbacks,
} from "./resume.js";
import { handleSettings, setupSettingsCallbacks } from "./settings.js";
import { handleDoctor, setupDoctorCallbacks } from "./doctor.js";
import { handleTunnel, handleTunnels, setupTunnelCallbacks } from "./tunnel.js";
import { handleSwitch, setupSwitchCallbacks } from "./switch.js";
import type { CommandRegistry } from "../../../core/command-registry.js";
import type { MenuRegistry } from "../../../core/menu-registry.js";

export function setupAllCallbacks(
  bot: Bot,
  core: OpenACPCore,
  chatId: number,
  systemTopicIds?: { notificationTopicId: number; assistantTopicId: number },
  getAssistantSession?: () =>
    | { topicId: number; enqueuePrompt: (p: string) => Promise<void> }
    | undefined,
  onControlMessage?: (sessionId: string, msgId: number) => void,
): void {
  // Register specific prefix handlers FIRST (grammY middleware order matters)
  setupResumeCallbacks(bot, core, chatId, onControlMessage);
  setupSessionCallbacks(bot, core, chatId, systemTopicIds);

  // Settings handlers — must be before broad m: handler
  setupSettingsCallbacks(bot, core, getAssistantSession ?? (() => undefined));

  // Doctor handlers — must be before broad m: handler
  setupDoctorCallbacks(bot);

  // Tunnel callbacks — must be before broad m: handler
  setupTunnelCallbacks(bot, core);

  // Switch agent callbacks — must be before broad m: handler
  setupSwitchCallbacks(bot, core);

  // Agent callbacks (install + pagination) — must be before broad m: handler
  bot.callbackQuery(/^ag:/, (ctx) => handleAgentCallback(ctx, core));

  // New session with specific agent callback — must be before broad m: handler
  bot.callbackQuery(/^na:/, async (ctx) => {
    const agentKey = ctx.callbackQuery.data!.replace("na:", "");
    await ctx.answerCallbackQuery();
    await createSessionDirect(
      ctx,
      core,
      chatId,
      agentKey,
      core.configManager.get().workspace.baseDir,
    );
  });

  // Archive confirmation callbacks
  bot.callbackQuery(/^ar:/, (ctx) => handleArchiveConfirm(ctx, core, chatId));

  // Broad m: handler for MenuRegistry dispatch — LAST
  bot.callbackQuery(/^m:/, async (ctx) => {
    const itemId = ctx.callbackQuery.data.replace('m:', '')
    try { await ctx.answerCallbackQuery() } catch { /* expired */ }

    const menuRegistry = core.lifecycleManager?.serviceRegistry?.get('menu-registry') as MenuRegistry | undefined
    if (!menuRegistry) return

    const item = menuRegistry.getItem(itemId)
    if (!item) return

    const topicId = ctx.callbackQuery.message?.message_thread_id
    const registry = core.lifecycleManager?.serviceRegistry?.get('command-registry') as CommandRegistry | undefined

    switch (item.action.type) {
      case 'command': {
        if (!registry) return
        const response = await registry.execute(item.action.command, {
          raw: '',
          channelId: 'telegram',
          userId: String(ctx.from.id),
          sessionId: null,
          reply: async () => {},
        })
        if (response.type !== 'delegated' && response.type !== 'silent') {
          if (response.type === 'text') {
            await ctx.reply(response.text, { parse_mode: 'HTML' }).catch(() => {})
          } else if (response.type === 'error') {
            await ctx.reply(`⚠️ ${response.message}`).catch(() => {})
          } else if (response.type === 'list') {
            const lines = response.items.map((i: { label: string; detail?: string }) => `• ${i.label}${i.detail ? ` — ${i.detail}` : ''}`).join('\n')
            await ctx.reply(`${response.title}\n${lines}`, { parse_mode: 'HTML' }).catch(() => {})
          }
        }
        break
      }
      case 'delegate': {
        const assistant = core.assistantManager?.get('telegram')
        if (assistant) {
          if (topicId && systemTopicIds && topicId !== systemTopicIds.assistantTopicId) {
            const { redirectToAssistant } = await import('../assistant.js')
            await ctx.reply(redirectToAssistant(chatId, systemTopicIds.assistantTopicId), { parse_mode: 'HTML' }).catch(() => {})
          } else {
            await assistant.enqueuePrompt(item.action.prompt)
          }
        } else {
          await ctx.reply('⚠️ Assistant is not available.').catch(() => {})
        }
        break
      }
      case 'callback':
        // Pass through to specific callback handlers
        break
    }
  })
}

// Backward compat alias
export { setupAllCallbacks as setupMenuCallbacks };

// Re-exports for external consumers (adapter.ts)
export { buildMenuKeyboard } from "./menu.js";
export { buildSkillMessages } from "./menu.js";
export {
  executeNewSession,
} from "./new-session.js";
export { executeCancelSession } from "./session.js";
export {
  setupDangerousModeCallbacks,
  buildDangerousModeKeyboard,
} from "./admin.js";
export {
  setupTTSCallbacks,
  setupVerbosityCallbacks,
  buildTTSKeyboard,
  buildSessionControlKeyboard,
  handleTTS,
  handleVerbosity,
  handleOutputMode,
} from "./admin.js";
export { setupIntegrateCallbacks } from "./integrate.js";
export { setupSettingsCallbacks } from "./settings.js";
export { setupDoctorCallbacks } from "./doctor.js";
export { setupResumeCallbacks } from "./resume.js";

export const STATIC_COMMANDS = [
  { command: "new", description: "Create new session" },
  { command: "newchat", description: "New chat, same agent & workspace" },
  { command: "cancel", description: "Cancel current session" },
  { command: "status", description: "Show status" },
  { command: "sessions", description: "List all sessions" },
  { command: "agents", description: "List available agents" },
  { command: "install", description: "Install a new agent" },
  { command: "help", description: "Help" },
  { command: "menu", description: "Show menu" },
  { command: "integrate", description: "Manage agent integrations" },
  { command: "handoff", description: "Continue this session in your terminal" },
  { command: "clear", description: "Clear assistant history" },
  { command: "restart", description: "Restart OpenACP" },
  { command: "update", description: "Update to latest version and restart" },
  { command: "doctor", description: "Run system diagnostics" },
  { command: "tunnel", description: "Create/stop tunnel for a local port" },
  { command: "tunnels", description: "List active tunnels" },
  { command: 'archive', description: 'Archive session topic (recreate with clean history)' },
  { command: 'text_to_speech', description: 'Toggle Text to Speech (/text_to_speech on, /text_to_speech off)' },
  { command: 'verbosity', description: 'Deprecated: use /outputmode instead' },
  { command: "outputmode", description: "Control output display level (low/medium/high)" },
  { command: 'resume', description: 'Resume with conversation history from Entire checkpoints' },
  { command: 'switch', description: 'Switch agent in current session' },
  { command: 'mode', description: 'Change session mode' },
  { command: 'model', description: 'Change AI model' },
  { command: 'thought', description: 'Change thinking level' },
  { command: 'bypass_permissions', description: 'Toggle bypass permissions (on/off)' },
];
