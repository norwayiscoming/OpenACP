import type { OpenACPCore, ChannelAdapter, Config, Session } from "../../core/index.js";
import { createChildLogger } from "../../core/log.js";
const log = createChildLogger({ module: "telegram-assistant" });

export type SpawnAssistantResult = {
  session: Session;
  /** Resolves when the background system prompt completes (or fails). */
  ready: Promise<void>;
};

export async function spawnAssistant(
  core: OpenACPCore,
  adapter: ChannelAdapter,
  assistantTopicId: number,
): Promise<SpawnAssistantResult> {
  const config = core.configManager.get();

  // Create session with default agent
  log.info({ agent: config.defaultAgent }, "Creating assistant session...");
  const session = await core.sessionManager.createSession(
    "telegram",
    config.defaultAgent,
    core.configManager.resolveWorkspace(),
    core.agentManager,
  );
  session.threadId = String(assistantTopicId);
  session.name = "Assistant"; // Prevent auto-naming from triggering after system prompt
  log.info({ sessionId: session.id }, "Assistant agent spawned");

  // Wire events first so the adapter is ready to receive real user responses.
  // The system prompt response will be suppressed by the adapter via the
  // assistantInitializing flag — it checks the flag before routing messages.
  core.wireSessionEvents(session, adapter);

  // Fire system prompt in background — don't block startup.
  const systemPrompt = buildAssistantSystemPrompt(config);
  const ready = session.enqueuePrompt(systemPrompt)
    .then(() => { log.info({ sessionId: session.id }, "Assistant system prompt completed"); })
    .catch((err) => { log.warn({ err }, "Assistant system prompt failed"); });

  return { session, ready };
}

export function buildAssistantSystemPrompt(config: Config): string {
  const agentNames = Object.keys(config.agents).join(", ");
  return `You are the OpenACP Assistant. Help users manage their AI coding sessions.

Available agents: ${agentNames}
Default agent: ${config.defaultAgent}
Workspace base: ${config.workspace.baseDir}

When a user wants to create a session, guide them through:
1. Which agent to use
2. Which workspace/project
3. Confirm and create

Commands reference:
- /new [agent] [workspace] — Create new session
- /newchat — New chat with same agent & workspace
- /cancel — Cancel current session
- /status — Show status
- /agents — List agents
- /help — Show help

Be concise and helpful. When the user confirms session creation, tell them you'll create it now.`;
}

export async function handleAssistantMessage(
  session: Session | null,
  text: string,
): Promise<void> {
  if (!session) return;
  await session.enqueuePrompt(text);
}

export function redirectToAssistant(
  chatId: number,
  assistantTopicId: number,
): string {
  const cleanId = String(chatId).replace("-100", "");
  const link = `https://t.me/c/${cleanId}/${assistantTopicId}`;
  return `💬 Please use the <a href="${link}">🤖 Assistant</a> topic to chat with OpenACP.`;
}
