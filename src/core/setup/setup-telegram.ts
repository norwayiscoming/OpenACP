import * as clack from "@clack/prompts";
import type { Config } from "../config.js";
import { guardCancel, ok, fail, warn, dim, c, step } from "./helpers.js";
import { validateBotToken, validateChatId, validateBotAdmin } from "./validation.js";

async function promptManualChatId(): Promise<number> {
  const val = guardCancel(
    await clack.text({
      message: "Supergroup chat ID (e.g. -1001234567890):",
      validate: (val) => {
        const n = Number((val ?? "").toString().trim());
        if (isNaN(n) || !Number.isInteger(n)) return "Chat ID must be an integer";
        return undefined;
      },
    }),
  ) as string;
  return Number(val.trim());
}

async function detectChatId(token: string): Promise<number> {
  // Clear old updates
  let lastUpdateId = 0;
  try {
    const clearRes = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=-1`,
    );
    const clearData = (await clearRes.json()) as {
      ok: boolean;
      result?: Array<{ update_id: number }>;
    };
    if (clearData.ok && clearData.result?.length) {
      lastUpdateId = clearData.result[clearData.result.length - 1].update_id;
    }
  } catch {
    // ignore
  }

  console.log("");
  console.log(`  ${c.bold}If you don't have a supergroup yet:${c.reset}`);
  console.log(dim("  1. Open Telegram → New Group → add your bot"));
  console.log(dim("  2. Group Settings → convert to Supergroup"));
  console.log(dim("  3. Enable Topics in group settings"));
  console.log("");
  console.log(`  ${c.bold}Then send "hi" in the group.${c.reset}`);
  console.log(
    dim(
      `  Listening... press ${c.reset}${c.yellow}m${c.reset}${c.dim} to enter ID manually`,
    ),
  );
  console.log("");

  const MAX_ATTEMPTS = 120;
  const POLL_INTERVAL = 1000;

  // Listen for 'm' keypress to switch to manual
  let cancelled = false;
  const onKeypress = (data: Buffer) => {
    const key = data.toString();
    if (key === "m" || key === "M") {
      cancelled = true;
    }
  };
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onKeypress);
  }

  const cleanup = () => {
    if (process.stdin.isTTY) {
      process.stdin.removeListener("data", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };

  try {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (cancelled) {
        cleanup();
        return promptManualChatId();
      }

      try {
        const offset = lastUpdateId ? lastUpdateId + 1 : 0;
        const res = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=1`,
        );
        const data = (await res.json()) as {
          ok: boolean;
          result?: Array<{
            update_id: number;
            message?: {
              chat: { id: number; title?: string; type: string };
            };
            my_chat_member?: {
              chat: { id: number; title?: string; type: string };
            };
          }>;
        };

        if (!data.ok || !data.result?.length) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          continue;
        }

        const groups = new Map<number, string>();
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          const chat = update.message?.chat ?? update.my_chat_member?.chat;
          if (chat && (chat.type === "supergroup" || chat.type === "group")) {
            groups.set(chat.id, chat.title ?? String(chat.id));
          }
        }

        if (groups.size === 1) {
          const [id, title] = [...groups.entries()][0];
          console.log(
            ok(`Group detected: ${c.bold}${title}${c.reset}${c.green} (${id})`),
          );
          cleanup();
          return id;
        }

        if (groups.size > 1) {
          cleanup();
          const options = [...groups.entries()].map(([id, title]) => ({
            label: `${title} (${id})`,
            value: id,
          }));
          return guardCancel(
            await clack.select({
              message: "Multiple groups found. Pick one:",
              options,
            }),
          );
        }
      } catch {
        // Network error, retry
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    console.log(warn("Timed out waiting for messages."));
    cleanup();
    return promptManualChatId();
  } catch (err) {
    cleanup();
    throw err;
  }
}

async function detectAndValidateChatId(botToken: string): Promise<number> {
  while (true) {
    const chatId = await detectChatId(botToken);
    const chatResult = await validateChatId(botToken, chatId);
    if (!chatResult.ok) {
      console.log(fail(chatResult.error));
      console.log("");
      console.log(`  ${c.bold}How to fix:${c.reset}`);
      console.log(dim("  1. Make sure the bot is added to the group"));
      console.log(dim("  2. The group must be a Supergroup (Group Settings → convert)"));
      console.log(dim("  3. Send a message in the group after adding the bot"));
      console.log("");
      guardCancel(await clack.text({ message: "Press Enter to try again..." }));
      continue;
    }
    console.log(
      ok(
        `Group: ${c.bold}${chatResult.title}${c.reset}${c.green}${chatResult.isForum ? " (Topics enabled)" : ""}`,
      ),
    );
    const adminResult = await validateBotAdmin(botToken, chatId);
    if (!adminResult.ok) {
      console.log(fail(adminResult.error));
      console.log("");
      console.log(`  ${c.bold}How to fix:${c.reset}`);
      console.log(dim("  1. Open the group in Telegram"));
      console.log(dim("  2. Go to Group Settings → Administrators"));
      console.log(dim("  3. Add the bot as an administrator"));
      console.log("");
      guardCancel(await clack.text({ message: "Press Enter to check again..." }));
      continue;
    }
    console.log(ok("Bot has admin privileges"));
    return chatId;
  }
}

export async function setupTelegram(opts?: {
  existing?: Config["channels"][string];
  stepNum?: number;
  totalSteps?: number;
}): Promise<Config["channels"][string]> {
  const { existing, stepNum, totalSteps } = opts ?? {};
  if (stepNum != null && totalSteps != null) {
    console.log(step(stepNum, totalSteps, "Telegram Bot"));
  }

  let botToken = "";
  const existingToken = (existing as { botToken?: string } | undefined)?.botToken;

  while (true) {
    const tokenInput = guardCancel(
      await clack.text({
        message: existingToken
          ? "Bot token (from @BotFather) — leave blank to keep current:"
          : "Bot token (from @BotFather):",
        ...(existingToken ? { placeholder: "Leave blank to keep current" } : {}),
        validate: (val) => {
          if (existingToken && (val ?? "").toString().trim().length === 0) return undefined;
          if ((val ?? "").toString().trim().length > 0) return undefined;
          return "Token cannot be empty";
        },
      }),
    ) as string;
    const keptExisting = existingToken && !tokenInput.trim();
    botToken = tokenInput.trim() || existingToken || "";
    if (!botToken) continue;

    // Skip validation if keeping existing token
    if (keptExisting) {
      console.log(ok("Keeping current bot token"));
      break;
    }

    const s = clack.spinner();
    s.start("Validating token...");
    const result = await validateBotToken(botToken);
    s.stop("Token validated");

    if (result.ok) {
      console.log(ok(`Connected to @${result.botUsername}`));
      break;
    }
    console.log(fail(result.error));
    const action = guardCancel(
      await clack.select({
        message: "What to do?",
        options: [
          { label: "Re-enter token", value: "retry" },
          { label: "Use as-is (skip validation)", value: "skip" },
        ],
      }),
    );
    if (action === "skip") break;
  }

  let chatId: number;
  const existingChatId = (existing as { chatId?: number } | undefined)?.chatId;

  if (existingChatId && existingChatId !== 0) {
    const chatIdAction = guardCancel(
      await clack.select({
        message: `Group chat ID: ${existingChatId}`,
        options: [
          { value: "keep" as const, label: "Keep current" },
          { value: "manual" as const, label: "Enter new chat ID" },
          { value: "detect" as const, label: "Auto-detect from group" },
        ],
        initialValue: "keep" as const,
      }),
    );
    if (chatIdAction === "keep") {
      chatId = existingChatId;
      console.log(ok("Keeping current group chat ID"));
    } else if (chatIdAction === "manual") {
      chatId = await promptManualChatId();
      // Validate the manually entered chat ID
      const chatResult = await validateChatId(botToken, chatId);
      if (chatResult.ok) {
        console.log(ok(`Group: ${c.bold}${chatResult.title}${c.reset}${c.green}${chatResult.isForum ? " (Topics enabled)" : ""}`));
      } else {
        console.log(fail(chatResult.error));
      }
    } else {
      chatId = await detectAndValidateChatId(botToken);
    }
  } else {
    chatId = await detectAndValidateChatId(botToken);
  }

  return {
    enabled: true,
    botToken,
    chatId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    notificationTopicId: (existing as any)?.notificationTopicId ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assistantTopicId: (existing as any)?.assistantTopicId ?? null,
  };
}
