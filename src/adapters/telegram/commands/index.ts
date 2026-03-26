import type { Bot, Context } from "grammy";
import type { OpenACPCore } from "../../../core/index.js";
import type { CommandsAssistantContext } from "../types.js";

// Domain modules
import { handleNew, handleNewChat, setupNewSessionCallbacks, createSessionDirect } from './new-session.js'
import { handleCancel, handleStatus, handleTopics, handleUsage, handleArchive, handleArchiveConfirm, handleSummary, handleSummaryCallback, setupSessionCallbacks } from './session.js'
import { handleEnableDangerous, handleDisableDangerous, handleUpdate, handleRestart, handleTTS, handleVerbosity } from './admin.js'
import { handleMenu, handleHelp, handleClear, buildMenuKeyboard } from './menu.js'
import { handleAgents, handleInstall, handleAgentCallback } from "./agents.js";
import { handleIntegrate } from "./integrate.js";
import {
  handleResume,
  setupResumeCallbacks,
  handlePendingResumeInput,
} from "./resume.js";
import { handleSettings, setupSettingsCallbacks } from "./settings.js";
import { handleDoctor, setupDoctorCallbacks } from "./doctor.js";
import { handleTunnel, handleTunnels, setupTunnelCallbacks } from "./tunnel.js";

export function setupCommands(
  bot: Bot,
  core: OpenACPCore,
  chatId: number,
  assistant?: CommandsAssistantContext,
): void {
  bot.command("new", (ctx) => handleNew(ctx, core, chatId, assistant));
  bot.command("newchat", (ctx) => handleNewChat(ctx, core, chatId));
  bot.command("cancel", (ctx) => handleCancel(ctx, core, assistant));
  bot.command("status", (ctx) => handleStatus(ctx, core));
  bot.command("sessions", (ctx) => handleTopics(ctx, core));
  bot.command("agents", (ctx) => handleAgents(ctx, core));
  bot.command("install", (ctx) => handleInstall(ctx, core));
  bot.command("help", (ctx) => handleHelp(ctx));
  bot.command("menu", (ctx) => handleMenu(ctx));
  bot.command("enable_dangerous", (ctx) => handleEnableDangerous(ctx, core));
  bot.command("disable_dangerous", (ctx) => handleDisableDangerous(ctx, core));
  bot.command("restart", (ctx) => handleRestart(ctx, core));
  bot.command("update", (ctx) => handleUpdate(ctx, core));
  bot.command("integrate", (ctx) => handleIntegrate(ctx, core));
  bot.command("clear", (ctx) => handleClear(ctx, assistant));
  bot.command("doctor", (ctx) => handleDoctor(ctx));
  bot.command("usage", (ctx) => handleUsage(ctx, core));
  bot.command("tunnel", (ctx) => handleTunnel(ctx, core));
  bot.command("tunnels", (ctx) => handleTunnels(ctx, core));
  bot.command("archive", (ctx) => handleArchive(ctx, core));
  bot.command("summary", (ctx) => handleSummary(ctx, core));
  bot.command("text_to_speech", (ctx) => handleTTS(ctx, core));
  bot.command("verbosity", (ctx) => handleVerbosity(ctx, core));
  bot.command("resume", (ctx) => handleResume(ctx, core, chatId, assistant));
}

export function setupAllCallbacks(
  bot: Bot,
  core: OpenACPCore,
  chatId: number,
  systemTopicIds?: { notificationTopicId: number; assistantTopicId: number },
  getAssistantSession?: () =>
    | { topicId: number; enqueuePrompt: (p: string) => Promise<void> }
    | undefined,
): void {
  // Register specific prefix handlers FIRST (grammY middleware order matters)
  setupNewSessionCallbacks(bot, core, chatId);
  setupResumeCallbacks(bot, core, chatId);
  setupSessionCallbacks(bot, core, chatId, systemTopicIds);

  // Settings handlers — must be before broad m: handler
  setupSettingsCallbacks(bot, core, getAssistantSession ?? (() => undefined));

  // Doctor handlers — must be before broad m: handler
  setupDoctorCallbacks(bot);

  // Tunnel callbacks — must be before broad m: handler
  setupTunnelCallbacks(bot, core);

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

  // Summary button callbacks
  bot.callbackQuery(/^sm:/, (ctx) => handleSummaryCallback(ctx, core, chatId));

  // Broad m: handler for remaining menu dispatch — LAST
  bot.callbackQuery(/^m:/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    try {
      await ctx.answerCallbackQuery();
    } catch {
      /* expired or network — ignore */
    }

    switch (data) {
      case "m:new":
        await handleNew(ctx, core, chatId);
        break;
      case "m:status":
        await handleStatus(ctx, core);
        break;
      case "m:agents":
        await handleAgents(ctx, core);
        break;
      case "m:help":
        await handleHelp(ctx);
        break;
      case "m:restart":
        await handleRestart(ctx, core);
        break;
      case "m:update":
        await handleUpdate(ctx, core);
        break;
      case "m:integrate":
        await handleIntegrate(ctx, core);
        break;
      case "m:topics":
        await handleTopics(ctx, core);
        break;
      case "m:settings":
        await handleSettings(ctx, core);
        break;
    }
  });
}

// Backward compat alias
export { setupAllCallbacks as setupMenuCallbacks };

// Re-exports for external consumers (adapter.ts, action-detect.ts)
export { buildMenuKeyboard } from "./menu.js";
export { buildSkillMessages } from "./menu.js";
export {
  handlePendingWorkspaceInput,
  executeNewSession,
  startInteractiveNewSession,
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
} from "./admin.js";
export { setupIntegrateCallbacks } from "./integrate.js";
export { setupSettingsCallbacks } from "./settings.js";
export { setupDoctorCallbacks } from "./doctor.js";
export { handlePendingResumeInput, setupResumeCallbacks } from "./resume.js";

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
  {
    command: "enable_dangerous",
    description: "Auto-approve all permission requests (session only)",
  },
  {
    command: "disable_dangerous",
    description: "Restore normal permission prompts (session only)",
  },
  { command: "integrate", description: "Manage agent integrations" },
  { command: "handoff", description: "Continue this session in your terminal" },
  { command: "clear", description: "Clear assistant history" },
  { command: "restart", description: "Restart OpenACP" },
  { command: "update", description: "Update to latest version and restart" },
  { command: "doctor", description: "Run system diagnostics" },
  { command: "usage", description: "View token usage and cost report" },
  { command: "tunnel", description: "Create/stop tunnel for a local port" },
  { command: "tunnels", description: "List active tunnels" },
  { command: 'archive', description: 'Archive session topic (recreate with clean history)' },
  { command: 'summary', description: 'Get AI summary of current session' },
  { command: 'text_to_speech', description: 'Toggle Text to Speech (/text_to_speech on, /text_to_speech off)' },
  { command: 'verbosity', description: 'Set display verbosity (/verbosity low|medium|high)' },
  { command: 'resume', description: 'Resume with conversation history from Entire checkpoints' },
];
