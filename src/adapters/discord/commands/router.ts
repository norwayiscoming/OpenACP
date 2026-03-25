import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
} from "discord.js";
import { log } from "../../../core/log.js";
import type { DiscordAdapter } from "../adapter.js";

import {
  handleNew,
  handleNewChat,
  handleNewSessionButton,
} from "./new-session.js";
import {
  handleCancel,
  handleStatus,
  handleSessions,
  handleHandoff,
  handleCleanupButton,
} from "./session.js";
import {
  handleDangerous,
  handleDangerousButton,
  handleTTS,
  handleTTSButton,
  handleRestart,
  handleUpdate,
  handleVerbosity,
} from "./admin.js";
import {
  handleMenu,
  handleHelp,
  handleClear,
  handleMenuButton,
} from "./menu.js";
import { handleAgents, handleInstall, handleAgentButton } from "./agents.js";
import { handleDoctor, handleDoctorButton } from "./doctor.js";
import { handleIntegrate, handleIntegrateButton } from "./integrate.js";
import { handleSettings, handleSettingsButton } from "./settings.js";

export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const { commandName } = interaction;

  try {
    switch (commandName) {
      case "new":
        await handleNew(interaction, adapter);
        break;
      case "newchat":
        await handleNewChat(interaction, adapter);
        break;
      case "cancel":
        await handleCancel(interaction, adapter);
        break;
      case "status":
        await handleStatus(interaction, adapter);
        break;
      case "sessions":
        await handleSessions(interaction, adapter);
        break;
      case "agents":
        await handleAgents(interaction, adapter);
        break;
      case "install":
        await handleInstall(interaction, adapter);
        break;
      case "menu":
        await handleMenu(interaction, adapter);
        break;
      case "help":
        await handleHelp(interaction, adapter);
        break;
      case "dangerous":
        await handleDangerous(interaction, adapter);
        break;
      case "restart":
        await handleRestart(interaction, adapter);
        break;
      case "update":
        await handleUpdate(interaction, adapter);
        break;
      case "integrate":
        await handleIntegrate(interaction, adapter);
        break;
      case "settings":
        await handleSettings(interaction, adapter);
        break;
      case "doctor":
        await handleDoctor(interaction, adapter);
        break;
      case "handoff":
        await handleHandoff(interaction, adapter);
        break;
      case "clear":
        await handleClear(interaction, adapter);
        break;
      case "tts":
        await handleTTS(interaction, adapter);
        break;
      case "verbosity":
        await handleVerbosity(interaction, adapter);
        break;
      default:
        log.warn({ commandName }, "[discord-router] Unknown slash command");
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `Unknown command: /${commandName}`,
            ephemeral: true,
          });
        }
    }
  } catch (err) {
    log.error(
      { err, commandName },
      "[discord-router] Slash command handler failed",
    );
    try {
      const errMsg = `❌ Command failed: ${err instanceof Error ? err.message : String(err)}`;
      if (interaction.deferred) {
        await interaction.editReply(errMsg);
      } else if (!interaction.replied) {
        await interaction.reply({ content: errMsg, ephemeral: true });
      }
    } catch {
      /* ignore reply errors */
    }
  }
}

export async function setupButtonCallbacks(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const { customId } = interaction;

  try {
    // Ordered from most specific to least specific
    if (customId.startsWith("a:dismiss:")) {
      // Action dismiss button — remove buttons from the message
      try {
        await interaction.update({ components: [] });
      } catch {
        /* ignore */
      }
      return;
    }

    if (customId.startsWith("a:")) {
      // Action confirm button (new session or cancel from assistant suggestions)
      const { getAction, removeAction } = await import("../action-detect.js");
      const actionId = customId.slice(2);
      const action = getAction(actionId);
      if (!action) {
        await interaction.reply({
          content: "❌ Action expired.",
          ephemeral: true,
        });
        return;
      }
      removeAction(actionId);
      if (action.type === "new_session") {
        await executeNewSession(
          interaction,
          adapter,
          action.agent,
          action.workspace,
        );
      } else if (action.type === "cancel_session") {
        await executeCancelSession(interaction, adapter);
      }
      return;
    }

    if (customId.startsWith("d:")) {
      await handleDangerousButton(interaction, adapter);
      return;
    }

    if (customId.startsWith("v:")) {
      await handleTTSButton(interaction, adapter);
      return;
    }

    if (customId.startsWith("m:new:")) {
      await handleNewSessionButton(interaction, adapter);
      return;
    }

    if (customId === "m:cleanup" || customId.startsWith("m:cleanup:")) {
      await handleCleanupButton(interaction, adapter);
      return;
    }

    if (customId === "m:doctor" || customId.startsWith("m:doctor:")) {
      await handleDoctorButton(interaction, adapter);
      return;
    }

    if (customId.startsWith("ag:")) {
      await handleAgentButton(interaction, adapter);
      return;
    }

    if (customId.startsWith("na:")) {
      // New session with specific agent (from install confirmation)
      const agentKey = customId.slice(3);
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch {
        /* ignore */
      }
      await executeNewSession(interaction, adapter, agentKey, undefined);
      return;
    }

    if (customId.startsWith("s:")) {
      await handleSettingsButton(interaction, adapter);
      return;
    }

    if (customId.startsWith("i:")) {
      await handleIntegrateButton(interaction, adapter);
      return;
    }

    // Catch-all m: handler
    if (customId.startsWith("m:")) {
      await handleMenuButton(interaction, adapter);
      return;
    }

    log.warn({ customId }, "[discord-router] Unhandled button interaction");
  } catch (err) {
    log.error({ err, customId }, "[discord-router] Button callback failed");
    try {
      const errMsg = `❌ Action failed: ${err instanceof Error ? err.message : String(err)}`;
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: errMsg, ephemeral: true });
      } else {
        await interaction.followUp({ content: errMsg, ephemeral: true });
      }
    } catch {
      /* ignore reply errors */
    }
  }
}

// Helper: execute new session from button interaction
async function executeNewSession(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
  agentName?: string,
  workspace?: string,
): Promise<void> {
  const { executeNewSession: doExecute } = await import("./new-session.js");
  await doExecute(interaction, adapter, agentName, workspace);
}

// Helper: execute cancel session from button interaction
async function executeCancelSession(
  interaction: ButtonInteraction,
  adapter: DiscordAdapter,
): Promise<void> {
  const { executeCancelSession: doCancel } = await import("./session.js");
  await doCancel(interaction, adapter);
}
