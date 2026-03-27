import * as os from "node:os";
import * as path from "node:path";
import * as clack from "@clack/prompts";
import type { Config } from "../config/config.js";
import type { ConfiguredChannelAction, ChannelId, ChannelStatus } from "./types.js";
import { CHANNEL_META } from "./types.js";
import { guardCancel, ok, c } from "./helpers.js";

export function getChannelStatuses(config: Config): ChannelStatus[] {
  const statuses: ChannelStatus[] = [];

  for (const [id, meta] of Object.entries(CHANNEL_META) as [ChannelId, typeof CHANNEL_META[ChannelId]][]) {
    const ch = config.channels[id] as Record<string, unknown> | undefined;
    const enabled = ch?.enabled === true;
    const configured = !!ch && Object.keys(ch).length > 1;

    let hint: string | undefined;
    if (id === "telegram" && ch?.botToken && typeof ch.botToken === "string" && ch.botToken !== "YOUR_BOT_TOKEN_HERE") {
      hint = `Chat ID: ${ch.chatId}`;
    }
    if (id === "discord" && ch?.guildId) {
      hint = `Guild: ${ch.guildId}`;
    }

    statuses.push({ id, label: meta.label, configured, enabled, hint });
  }

  return statuses;
}

export function noteChannelStatus(config: Config): void {
  const statuses = getChannelStatuses(config);
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

async function configureViaPlugin(channelId: ChannelId): Promise<void> {
  const pluginImports: Record<ChannelId, () => Promise<any>> = {
    telegram: () => import('../../plugins/telegram/index.js'),
    discord: async () => {
      const pkg = '@openacp/adapter-discord';
      try {
        return await import(/* webpackIgnore: true */ pkg);
      } catch {
        throw new Error(
          `${pkg} is not installed. Run: openacp plugin add ${pkg}`,
        );
      }
    },
  };

  const importer = pluginImports[channelId];
  if (!importer) return;

  const { SettingsManager } = await import('../plugin/settings-manager.js');
  const { createInstallContext } = await import('../plugin/install-context.js');
  const basePath = path.join(os.homedir(), '.openacp', 'plugins');
  const settingsManager = new SettingsManager(basePath);

  const pluginModule = await importer();
  const plugin = pluginModule.default;

  if (plugin?.configure) {
    const ctx = createInstallContext({
      pluginName: plugin.name,
      settingsManager,
      basePath,
    });
    await plugin.configure(ctx);
  }
}

export async function configureChannels(config: Config): Promise<{ config: Config; changed: boolean }> {
  const next = structuredClone(config);
  let changed = false;

  noteChannelStatus(next);

  while (true) {
    const statuses = getChannelStatuses(next);
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
    const existing = next.channels[channelId] as Record<string, unknown> | undefined;
    const isConfigured = !!existing && Object.keys(existing).length > 1;

    if (isConfigured) {
      const action = await promptConfiguredAction(meta.label);

      if (action === "skip") continue;
      if (action === "disable") {
        (next.channels[channelId] as Record<string, unknown>).enabled = false;
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
          delete next.channels[channelId];
          changed = true;
          console.log(ok(`${meta.label} config deleted`));
        }
        continue;
      }
      // action === "modify" — fall through to plugin configure
    }

    // Run channel configuration via plugin configure()
    await configureViaPlugin(channelId);
    changed = true;
  }

  return { config: next, changed };
}
