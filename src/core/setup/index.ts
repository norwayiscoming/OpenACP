// Public API — maintains backward compatibility with all existing imports from setup.ts

export { runSetup, runReconfigure } from "./wizard.js";
export { printStartBanner } from "./helpers.js";

// Validation functions (used by config-editor.ts and tests)
export {
  validateBotToken,
  validateChatId,
  validateBotAdmin,
  validateDiscordToken,
} from "./validation.js";

// Agent detection (used by tests)
export { detectAgents, validateAgentCommand } from "./setup-agents.js";

// Setup functions — re-exported for backward compat (were public in old setup.ts)
export { setupTelegram } from "./setup-telegram.js";
export { setupDiscord } from "./setup-discord.js";
export { setupAgents } from "./setup-agents.js";
export { setupWorkspace } from "./setup-workspace.js";
export { setupRunMode } from "./setup-run-mode.js";
