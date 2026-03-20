import type { OpenACPCore, ChannelAdapter, Config } from "@openacp/core";
import type { Session } from "@openacp/core";

export async function spawnAssistant(
  core: OpenACPCore,
  adapter: ChannelAdapter,
  assistantTopicId: number,
): Promise<Session> {
  const config = core.configManager.get();

  // Create session with default agent
  const session = await core.sessionManager.createSession(
    "telegram",
    config.defaultAgent,
    core.configManager.resolveWorkspace(),
    core.agentManager,
  );
  session.threadId = String(assistantTopicId);

  // Send system prompt BEFORE wiring events. enqueuePrompt awaits the full
  // agent response, so by the time it returns the system prompt conversation
  // is complete. Since no event handler is wired yet, the response is
  // intentionally discarded — users only see responses to their own messages.
  const systemPrompt = buildAssistantSystemPrompt(config);
  await session.enqueuePrompt(systemPrompt);

  // Wire events to adapter — only messages after this point reach the user
  core.wireSessionEvents(session, adapter);

  return session;
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
- /new_chat — New chat with same agent & workspace
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
