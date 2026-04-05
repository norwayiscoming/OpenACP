import * as path from "node:path";
import { getGlobalRoot } from "../instance/instance-context.js";
import * as clack from "@clack/prompts";
import type { Config } from "../config/config.js";
import type { SettingsManager } from "../plugin/settings-manager.js";
import type { ConfiguredChannelAction, ChannelId, ChannelStatus } from "./types.js";
import { CHANNEL_META } from "./types.js";
import { guardCancel, ok, c } from "./helpers.js";

// Maps logical channel ID → plugin name used for settings storage and dynamic import.
// Telegram is built-in so it has no entry here (handled separately via direct import).
const CHANNEL_PLUGIN_NAME: Record<string, string> = {
  discord: "@openacp/discord-adapter",
};

export async function getChannelStatuses(config: Config, settingsManager?: SettingsManager): Promise<ChannelStatus[]> {
  const statuses: ChannelStatus[] = [];

  for (const [id, meta] of Object.entries(CHANNEL_META) as [ChannelId, typeof CHANNEL_META[ChannelId]][]) {
    let configured = false;
    let enabled = false;
    let hint: string | undefined;

    // Read channel status from plugin settings (channels migrated out of config.json)
    if (settingsManager && id === "telegram") {
      const ps = await settingsManager.loadSettings("@openacp/telegram");
      if (ps.botToken && ps.chatId) {
        configured = true;
        enabled = ps.enabled !== false; // enabled by default when configured
        hint = `Chat ID: ${ps.chatId}`;
      }
    } else if (settingsManager && id === "discord") {
      const ps = await settingsManager.loadSettings("@openacp/discord-adapter");
      if (ps.guildId || ps.token) {
        configured = true;
        enabled = ps.enabled !== false;
        hint = ps.guildId ? `Guild: ${ps.guildId}` : undefined;
      }
    }

    statuses.push({ id, label: meta.label, configured, enabled, hint });
  }

  return statuses;
}

export async function noteChannelStatus(config: Config, settingsManager?: SettingsManager): Promise<void> {
  const statuses = await getChannelStatuses(config, settingsManager);
  const lines = statuses.map((s) => {
    const status = s.enabled ? "enabled" : s.configured ? "disabled" : "not configured";
    const hintStr = s.hint ? ` — ${s.hint}` : "";
    return `  ${s.label}: ${status}${hintStr}`;
  });

  console.log("");
  console.log(`${c.bold}  Channel status${c.reset}`);
  for (const line of lines) console.log(line);
  console.log("");
}

async function promptConfiguredAction(label: string): Promise<ConfiguredChannelAction> {
  return guardCancel(
    await clack.select({
      message: `${label} already configured. What do you want to do?`,
      options: [
        { value: "modify" as const, label: "Modify settings" },
        { value: "disable" as const, label: "Disable bot" },
        { value: "delete" as const, label: "Delete config" },
        { value: "skip" as const, label: "Skip (leave as-is)" },
      ],
      initialValue: "modify" as const,
    }),
  );
}

async function configureViaPlugin(channelId: string, isConfigured: boolean, settingsManager?: SettingsManager): Promise<void> {
  // SSE (Desktop App) connects automatically; no user configuration needed.
  if (channelId === 'sse') return;

  let plugin: any;
  if (channelId === 'telegram') {
    const pluginModule = await import('../../plugins/telegram/index.js');
    plugin = pluginModule.default;
  } else {
    // Use the known plugin package name; fall back to scoped package name for unknown adapters.
    const packageName = CHANNEL_PLUGIN_NAME[channelId] ?? `@openacp/${channelId}`;
    try {
      const pluginModule = await import(packageName);
      plugin = pluginModule.default;
    } catch (err) {
      console.log(`Could not load plugin "${packageName}": ${(err as Error).message}`);
      return;
    }
  }

  if (!plugin) {
    console.log(`Plugin for channel "${channelId}" did not export a valid default.`);
    return;
  }

  const { createInstallContext } = await import('../plugin/install-context.js');
  let sm = settingsManager;
  if (!sm) {
    const { SettingsManager: SM } = await import('../plugin/settings-manager.js');
    const basePath = path.join(getGlobalRoot(), 'plugins', 'data');
    sm = new SM(basePath);
  }
  const ctx = createInstallContext({
    pluginName: plugin.name,
    settingsManager: sm,
    basePath: sm.getBasePath(),
  });

  if (!isConfigured && plugin.install) {
    // First-time setup: run the full guided install flow
    await plugin.install(ctx);
  } else if (plugin.configure) {
    // Already configured: allow editing individual settings
    await plugin.configure(ctx);
  }
}

export async function configureChannels(config: Config, settingsManager?: SettingsManager): Promise<{ config: Config; changed: boolean }> {
  const next = structuredClone(config);
  let changed = false;

  await noteChannelStatus(next, settingsManager);

  while (true) {
    const statuses = await getChannelStatuses(next, settingsManager);
    const options = statuses.map((s) => {
      const status = s.enabled ? "enabled" : s.configured ? "disabled" : "not configured";
      return {
        value: s.id,
        label: `${s.label} (${CHANNEL_META[s.id].method})`,
        hint: status + (s.hint ? ` · ${s.hint}` : ""),
      };
    });

    const choice = guardCancel(
      await clack.select({
        message: "Select a channel",
        options: [
          ...options,
          { value: "__done__" as const, label: "Finished" },
        ],
      }),
    );

    if (choice === "__done__") break;

    const channelId = choice as ChannelId;
    const meta = CHANNEL_META[channelId];
    const statuses2 = await getChannelStatuses(next, settingsManager);
    const isConfigured = statuses2.find(s => s.id === channelId)?.configured ?? false;

    if (isConfigured) {
      const action = await promptConfiguredAction(meta.label);

      if (action === "skip") continue;
      const pluginName = CHANNEL_PLUGIN_NAME[channelId] ?? `@openacp/${channelId}`;

      if (action === "disable") {
        // Disable via plugin settings (channels migrated out of config.json)
        if (settingsManager) {
          await settingsManager.updatePluginSettings(pluginName, { enabled: false });
        }
        changed = true;
        console.log(ok(`${meta.label} disabled`));
        continue;
      }
      if (action === "delete") {
        const confirmed = guardCancel(
          await clack.confirm({
            message: `Delete ${meta.label} config? This cannot be undone.`,
            initialValue: false,
          }),
        );
        if (confirmed) {
          // Clear plugin settings (channels migrated out of config.json)
          if (settingsManager) {
            await settingsManager.updatePluginSettings(pluginName, {});
          }
          changed = true;
          console.log(ok(`${meta.label} config deleted`));
        }
        continue;
      }
      // action === "modify" — fall through to plugin configure
    }

    // Run channel configuration via plugin install() or configure()
    await configureViaPlugin(channelId, isConfigured, settingsManager);
    changed = true;
  }

  return { config: next, changed };
}
