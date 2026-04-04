export interface WelcomeContext {
  activeCount: number;
  errorCount: number;
  totalCount: number;
  agents: string[];
  defaultAgent: string;
  workspace: string;
}

export function buildWelcomeMessage(ctx: WelcomeContext): string {
  const { activeCount, errorCount, totalCount, agents, defaultAgent, workspace } = ctx;

  const agentList = agents
    .map((a) => `${a}${a === defaultAgent ? " (default)" : ""}`)
    .join(", ");

  // Variant 1: No sessions
  if (totalCount === 0) {
    return (
      `👋 <b>OpenACP is ready!</b>\n\n` +
      `📂 ${workspace}\n\n` +
      `No sessions yet. Tap 🆕 New Session to start, or ask me anything!`
    );
  }

  // Variant 2: Has errors
  if (errorCount > 0) {
    return (
      `👋 <b>OpenACP is ready!</b>\n\n` +
      `📂 ${workspace}\n` +
      `📊 ${activeCount} active, ${errorCount} errors / ${totalCount} total\n` +
      `⚠️ ${errorCount} session${errorCount > 1 ? "s have" : " has"} errors — ask me to check if you'd like.\n\n` +
      `Agents: ${agentList}`
    );
  }

  // Variant 3/4: Has active or fallback
  return (
    `👋 <b>OpenACP is ready!</b>\n\n` +
    `📂 ${workspace}\n` +
    `📊 ${activeCount} active / ${totalCount} total\n` +
    `Agents: ${agentList}`
  );
}

export function redirectToAssistant(
  chatId: number,
  assistantTopicId: number,
): string {
  const cleanId = String(chatId).replace("-100", "");
  const link = `https://t.me/c/${cleanId}/${assistantTopicId}`;
  return `💬 Please use the <a href="${link}">🤖 Assistant</a> topic to chat with OpenACP.`;
}
