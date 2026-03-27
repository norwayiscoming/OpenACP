import { readApiPort } from '../api-client.js'
import { wantsHelp } from './helpers.js'

export async function cmdAdopt(args: string[]): Promise<void> {
  if (wantsHelp(args)) {
    console.log(`
\x1b[1mopenacp adopt\x1b[0m — Adopt an external agent session

\x1b[1mUsage:\x1b[0m
  openacp adopt <agent> <session_id> [--cwd <path>] [--channel <name>]

\x1b[1mArguments:\x1b[0m
  <agent>         Agent name (e.g. claude)
  <session_id>    External session ID to adopt

\x1b[1mOptions:\x1b[0m
  --cwd <path>       Working directory for the session (default: current dir)
  --channel <name>   Target channel adapter (e.g. telegram, discord). Default: first registered
  -h, --help         Show this help message

Transfers an existing agent session into OpenACP so it appears
as a messaging thread. Requires a running daemon.

\x1b[1mExamples:\x1b[0m
  openacp adopt claude abc123-def456
  openacp adopt claude abc123 --cwd /path/to/project
  openacp adopt claude abc123 --channel discord
`)
    return
  }

  const agent = args[1];
  const sessionId = args[2];

  if (!agent || !sessionId) {
    console.log("Usage: openacp adopt <agent> <session_id> [--cwd <path>] [--channel <name>]");
    console.log("Example: openacp adopt claude abc123-def456 --cwd /path/to/project");
    process.exit(1);
  }

  const cwdIdx = args.indexOf("--cwd");
  const cwd = cwdIdx !== -1 && args[cwdIdx + 1] ? args[cwdIdx + 1] : process.cwd();
  const channelIdx = args.indexOf("--channel");
  const channel = channelIdx !== -1 && args[channelIdx + 1] ? args[channelIdx + 1] : undefined;

  const port = readApiPort();
  if (!port) {
    console.log("OpenACP is not running. Start it with: openacp start");
    process.exit(1);
  }

  try {
    const { apiCall } = await import('../api-client.js')
    const res = await apiCall(port, '/api/sessions/adopt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, agentSessionId: sessionId, cwd, channel }),
    })
    const data = await res.json() as Record<string, unknown>;

    if (data.ok) {
      if (data.status === "existing") {
        console.log(`Session already active. Topic pinged.`);
      } else {
        console.log(`Session transferred to messaging platform.`);
      }
      console.log(`  Session ID: ${data.sessionId}`);
      console.log(`  Thread ID:  ${data.threadId}`);
    } else {
      console.log(`Error: ${(data.message as string) || (data.error as string)}`);
      process.exit(1);
    }
  } catch (err) {
    console.log(`Failed to connect to OpenACP: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
