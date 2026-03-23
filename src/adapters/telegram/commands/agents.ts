import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { OpenACPCore } from "../../../core/core.js";
import type { InstallProgress } from "../../../core/types.js";
import { escapeHtml } from "../formatting.js";

const AGENTS_PER_PAGE = 6;

export async function handleAgents(ctx: Context, core: OpenACPCore, page = 0): Promise<void> {
  const catalog = core.agentCatalog;
  const items = catalog.getAvailable();

  const installed = items.filter((i) => i.installed);
  const available = items.filter((i) => !i.installed);

  let text = "<b>🤖 Agents</b>\n\n";

  // Installed agents section
  if (installed.length > 0) {
    text += "<b>Installed:</b>\n";
    for (const item of installed) {
      text += `✅ <b>${escapeHtml(item.name)}</b>`;
      if (item.description) {
        text += ` — <i>${escapeHtml(truncate(item.description, 50))}</i>`;
      }
      text += "\n";
    }
    text += "\n";
  }

  // Available agents section (paginated)
  if (available.length > 0) {
    const totalPages = Math.ceil(available.length / AGENTS_PER_PAGE);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const pageItems = available.slice(safePage * AGENTS_PER_PAGE, (safePage + 1) * AGENTS_PER_PAGE);

    text += `<b>Available to install:</b>`;
    if (totalPages > 1) {
      text += ` (${safePage + 1}/${totalPages})`;
    }
    text += "\n";

    for (const item of pageItems) {
      if (item.available) {
        text += `⬇️ <b>${escapeHtml(item.name)}</b>`;
      } else {
        const deps = item.missingDeps?.join(", ") ?? "requirements not met";
        text += `⚠️ <b>${escapeHtml(item.name)}</b> <i>(needs: ${escapeHtml(deps)})</i>`;
      }
      if (item.description) {
        text += `\n    <i>${escapeHtml(truncate(item.description, 60))}</i>`;
      }
      text += "\n";
    }

    // Install buttons for current page
    const keyboard = new InlineKeyboard();
    const installable = pageItems.filter((i) => i.available);
    for (let i = 0; i < installable.length; i += 2) {
      const row = installable.slice(i, i + 2);
      for (const item of row) {
        keyboard.text(`⬇️ ${item.name}`, `ag:install:${item.key}`);
      }
      keyboard.row();
    }

    // Pagination buttons
    if (totalPages > 1) {
      if (safePage > 0) {
        keyboard.text("◀️ Prev", `ag:page:${safePage - 1}`);
      }
      if (safePage < totalPages - 1) {
        keyboard.text("Next ▶️", `ag:page:${safePage + 1}`);
      }
      keyboard.row();
    }

    // Tip for CLI install
    if (available.some((i) => !i.available)) {
      text += "\n💡 <i>Agents marked ⚠️ need additional setup. Use</i> <code>openacp agents info &lt;name&gt;</code> <i>for details.</i>\n";
    }

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  } else {
    text += "<i>All agents are already installed!</i>";
    await ctx.reply(text, { parse_mode: "HTML" });
  }
}

export async function handleInstall(ctx: Context, core: OpenACPCore): Promise<void> {
  const text = (ctx.message?.text ?? "").trim();
  const parts = text.split(/\s+/);
  const nameOrId = parts[1];

  if (!nameOrId) {
    await ctx.reply(
      "📦 <b>Install an agent</b>\n\n" +
        "Usage: <code>/install &lt;agent-name&gt;</code>\n" +
        "Example: <code>/install gemini</code>\n\n" +
        "Use /agents to browse available agents.",
      { parse_mode: "HTML" },
    );
    return;
  }

  await installAgentWithProgress(ctx, core, nameOrId);
}

export async function handleAgentCallback(ctx: Context, core: OpenACPCore): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  await ctx.answerCallbackQuery();

  if (data.startsWith("ag:install:")) {
    const nameOrId = data.replace("ag:install:", "");
    await installAgentWithProgress(ctx, core, nameOrId);
    return;
  }

  if (data.startsWith("ag:page:")) {
    const page = parseInt(data.replace("ag:page:", ""), 10);
    // Edit the existing message with the new page
    try {
      const catalog = core.agentCatalog;
      const items = catalog.getAvailable();
      const installed = items.filter((i) => i.installed);
      const available = items.filter((i) => !i.installed);

      let text = "<b>🤖 Agents</b>\n\n";

      if (installed.length > 0) {
        text += "<b>Installed:</b>\n";
        for (const item of installed) {
          text += `✅ <b>${escapeHtml(item.name)}</b>`;
          if (item.description) {
            text += ` — <i>${escapeHtml(truncate(item.description, 50))}</i>`;
          }
          text += "\n";
        }
        text += "\n";
      }

      const totalPages = Math.ceil(available.length / AGENTS_PER_PAGE);
      const safePage = Math.max(0, Math.min(page, totalPages - 1));
      const pageItems = available.slice(safePage * AGENTS_PER_PAGE, (safePage + 1) * AGENTS_PER_PAGE);

      text += `<b>Available to install:</b>`;
      if (totalPages > 1) {
        text += ` (${safePage + 1}/${totalPages})`;
      }
      text += "\n";

      for (const item of pageItems) {
        if (item.available) {
          text += `⬇️ <b>${escapeHtml(item.name)}</b>`;
        } else {
          const deps = item.missingDeps?.join(", ") ?? "requirements not met";
          text += `⚠️ <b>${escapeHtml(item.name)}</b> <i>(needs: ${escapeHtml(deps)})</i>`;
        }
        if (item.description) {
          text += `\n    <i>${escapeHtml(truncate(item.description, 60))}</i>`;
        }
        text += "\n";
      }

      const keyboard = new InlineKeyboard();
      const installable = pageItems.filter((i) => i.available);
      for (let i = 0; i < installable.length; i += 2) {
        const row = installable.slice(i, i + 2);
        for (const item of row) {
          keyboard.text(`⬇️ ${item.name}`, `ag:install:${item.key}`);
        }
        keyboard.row();
      }

      if (totalPages > 1) {
        if (safePage > 0) {
          keyboard.text("◀️ Prev", `ag:page:${safePage - 1}`);
        }
        if (safePage < totalPages - 1) {
          keyboard.text("Next ▶️", `ag:page:${safePage + 1}`);
        }
        keyboard.row();
      }

      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch { /* ignore edit failures */ }
  }
}

async function installAgentWithProgress(ctx: Context, core: OpenACPCore, nameOrId: string): Promise<void> {
  const catalog = core.agentCatalog;
  const msg = await ctx.reply(`⏳ Installing <b>${escapeHtml(nameOrId)}</b>...`, { parse_mode: "HTML" });

  let lastEdit = 0;
  const EDIT_THROTTLE_MS = 1500;

  const progress: InstallProgress = {
    onStart(_id, _name) { /* initial message already sent */ },
    async onStep(step) {
      const now = Date.now();
      if (now - lastEdit > EDIT_THROTTLE_MS) {
        lastEdit = now;
        try {
          await ctx.api.editMessageText(msg.chat.id, msg.message_id, `⏳ <b>${escapeHtml(nameOrId)}</b>: ${escapeHtml(step)}`, { parse_mode: "HTML" });
        } catch { /* rate limit or unchanged */ }
      }
    },
    async onDownloadProgress(percent) {
      const now = Date.now();
      if (now - lastEdit > EDIT_THROTTLE_MS) {
        lastEdit = now;
        try {
          const bar = buildProgressBar(percent);
          await ctx.api.editMessageText(msg.chat.id, msg.message_id, `⏳ <b>${escapeHtml(nameOrId)}</b>\nDownloading... ${bar} ${percent}%`, { parse_mode: "HTML" });
        } catch { /* rate limit */ }
      }
    },
    async onSuccess(name) {
      try {
        const keyboard = new InlineKeyboard().text(`🚀 Start session with ${name}`, `na:${nameOrId}`);
        await ctx.api.editMessageText(msg.chat.id, msg.message_id, `✅ <b>${escapeHtml(name)}</b> installed!`, { parse_mode: "HTML", reply_markup: keyboard });
      } catch { /* ignore */ }
    },
    async onError(error) {
      try {
        await ctx.api.editMessageText(msg.chat.id, msg.message_id, `❌ ${escapeHtml(error)}`, { parse_mode: "HTML" });
      } catch { /* ignore */ }
    },
  };

  const result = await catalog.install(nameOrId, progress);

  // Show setup steps as a follow-up message
  if (result.ok && result.setupSteps?.length) {
    let setupText = `📋 <b>Setup for ${escapeHtml(result.agentKey)}:</b>\n\n`;
    for (const step of result.setupSteps) {
      setupText += `→ ${escapeHtml(step)}\n`;
    }
    setupText += `\n<i>Run in terminal: openacp agents info ${escapeHtml(result.agentKey)}</i>`;
    try {
      await ctx.reply(setupText, { parse_mode: "HTML" });
    } catch { /* ignore */ }
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function buildProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}
