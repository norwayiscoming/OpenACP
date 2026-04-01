import { wantsHelp } from './helpers.js'

export async function cmdIntegrate(args: string[]): Promise<void> {
  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp integrate\x1b[0m — Manage agent integrations

\x1b[1mUsage:\x1b[0m
  openacp integrate <agent>              Install integration for an agent
  openacp integrate <agent> --uninstall  Remove integration

\x1b[1mArguments:\x1b[0m
  <agent>         Agent name (e.g. claude)

\x1b[1mOptions:\x1b[0m
  --uninstall     Remove the integration instead of installing
  -h, --help      Show this help message

Integrations enable features like session handoff from an agent
to OpenACP (Telegram/Discord). For example, the Claude integration adds
a "Handoff" slash command to Claude Code.

\x1b[1mExamples:\x1b[0m
  openacp integrate claude
  openacp integrate claude --uninstall
`)
    return
  }

  const { getIntegration, listIntegrations } = await import("../integrate.js");

  const agent = args[0];
  const uninstall = args.includes("--uninstall");

  if (!agent) {
    console.log("Usage: openacp integrate <agent> [--uninstall]");
    console.log(`Available integrations: ${listIntegrations().join(", ")}`);
    process.exit(1);
  }

  const integration = getIntegration(agent);
  if (!integration) {
    const { suggestMatch } = await import('../suggest.js');
    const available = listIntegrations();
    const suggestion = suggestMatch(agent, available);
    console.log(`No integration available for '${agent}'.`);
    if (suggestion) console.log(`Did you mean: ${suggestion}?`);
    console.log(`Available: ${available.join(", ")}`);
    process.exit(1);
  }

  for (const item of integration.items) {
    if (uninstall) {
      console.log(`Removing ${agent}/${item.id}...`);
      const result = await item.uninstall();
      for (const log of result.logs) console.log(`  ${log}`);
      if (result.success) {
        console.log(`  ${item.name} removed.`);
      } else {
        console.log(`  Failed to remove ${item.name}.`);
        process.exit(1);
      }
    } else {
      console.log(`Installing ${agent}/${item.id}...`);
      const result = await item.install();
      for (const log of result.logs) console.log(`  ${log}`);
      if (result.success) {
        console.log(`  ${item.name} installed.`);
      } else {
        console.log(`  Failed to install ${item.name}.`);
        process.exit(1);
      }
    }
  }
}
