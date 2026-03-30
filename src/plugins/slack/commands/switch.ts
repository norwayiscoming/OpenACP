import type { App } from "@slack/bolt";
import type { OpenACPCore } from "../../../core/core.js";
import { createChildLogger } from "../../../core/utils/log.js";
import type { SlackSessionMeta } from "../types.js";

const log = createChildLogger({ module: "slack-cmd-switch" });

type SessionLookupFn = (channelId: string) => SlackSessionMeta | undefined;

export function registerSwitchCommand(
  app: App,
  core: OpenACPCore,
  sessionLookup: SessionLookupFn,
): void {
  // Handle /switch slash command from Slack
  // Note: Slack slash command name must match what is configured in the Slack app manifest.
  // The command is registered as /openacp-switch to avoid conflicts with other apps.
  app.command("/openacp-switch", async ({ command, ack, respond }) => {
    await ack();

    const channelId = command.channel_id;

    // Find session by channel
    const meta = sessionLookup(channelId);
    if (!meta) {
      await respond("No active session in this channel.");
      return;
    }

    const session = core.sessionManager.getSessionByThread("slack", meta.channelSlug);
    if (!session) {
      await respond("No active session in this channel.");
      return;
    }

    const raw = (command.text ?? "").trim();

    // /openacp-switch label on|off
    if (raw.startsWith("label ")) {
      const value = raw.slice(6).trim().toLowerCase();
      if (value === "on" || value === "off") {
        await core.configManager.save(
          { agentSwitch: { labelHistory: value === "on" } },
          "agentSwitch.labelHistory",
        );
        await respond(`Agent label in history: ${value}`);
      } else {
        await respond("Usage: /openacp-switch label on|off");
      }
      return;
    }

    // /openacp-switch (no args) → show menu
    if (!raw) {
      const agents = core.agentManager.getAvailableAgents();
      const currentAgent = session.agentName;
      const options = agents.filter((a) => a.name !== currentAgent);

      if (options.length === 0) {
        await respond("No other agents available.");
        return;
      }

      await respond({
        blocks: [
          {
            type: "section" as const,
            text: {
              type: "mrkdwn" as const,
              text: `*Switch Agent*\nCurrent: \`${currentAgent}\`\n\nSelect an agent:`,
            },
          },
          {
            type: "actions" as const,
            elements: options.slice(0, 5).map((agent) => ({
              type: "button" as const,
              text: { type: "plain_text" as const, text: agent.name },
              action_id: `sw:${agent.name}`,
              value: agent.name,
            })),
          },
        ],
        text: "Switch Agent",
      });
      return;
    }

    // /openacp-switch <agentName> → direct switch
    await executeSwitchAgent(respond, core, session.id, raw);
  });

  // Handle switch button clicks
  app.action(/^sw:/, async ({ action, ack, respond, body }) => {
    await ack();

    const buttonAction = action as unknown as { value?: string; action_id?: string };
    const agentName = buttonAction.value ?? buttonAction.action_id?.replace("sw:", "") ?? "";

    if (!agentName) {
      await respond("Unknown agent.");
      return;
    }

    // Find the session from the channel where the button was clicked
    const channelId = (body as unknown as { channel?: { id?: string } }).channel?.id;

    if (!channelId) {
      await respond("Could not determine session for this action.");
      return;
    }

    const meta = sessionLookup(channelId);
    if (!meta) {
      await respond("No active session in this channel.");
      return;
    }

    const session = core.sessionManager.getSessionByThread("slack", meta.channelSlug);
    if (!session) {
      await respond("No active session in this channel.");
      return;
    }

    await executeSwitchAgent(respond, core, session.id, agentName);
  });
}

async function executeSwitchAgent(
  respond: (msg: string | Record<string, unknown>) => Promise<unknown>,
  core: OpenACPCore,
  sessionId: string,
  agentName: string,
): Promise<void> {
  try {
    const { resumed } = await core.switchSessionAgent(sessionId, agentName);
    const status = resumed ? "resumed" : "new session";
    await respond(`Switched to *${agentName}* (${status})`);
    log.info({ sessionId, agentName, resumed }, "Agent switched via /openacp-switch");
  } catch (err: any) {
    await respond(`Failed to switch agent: ${err.message || err}`);
    log.warn({ sessionId, agentName, err: err.message }, "Agent switch failed");
  }
}
