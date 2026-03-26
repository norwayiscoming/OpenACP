import * as clack from "@clack/prompts";
import type { Config } from "../config.js";
import { guardCancel } from "./helpers.js";

export async function setupIntegrations(config?: Config): Promise<void> {
  const claudeIntegration = (config?.integrations as Record<string, unknown> | undefined)?.claude as { installed?: boolean } | undefined;
  const isInstalled = claudeIntegration?.installed === true;

  const installClaude = guardCancel(
    await clack.confirm({
      message: isInstalled
        ? "Claude CLI integration is installed. Reinstall?"
        : "Install session transfer for Claude? (enables /openacp:handoff in your terminal)",
      initialValue: !isInstalled,
    }),
  );

  if (installClaude) {
    try {
      const { getIntegration } = await import("../../cli/integrate.js");
      const integration = getIntegration("claude");
      if (integration) {
        for (const item of integration.items) {
          const result = await item.install();
          for (const log of result.logs) console.log(`  ${log}`);
        }
      }
      console.log("Claude CLI integration installed.\n");
    } catch (err) {
      console.log(`Could not install Claude CLI integration: ${err instanceof Error ? err.message : err}`);
      console.log("  You can install it later with: openacp integrate claude\n");
    }
  }
}
