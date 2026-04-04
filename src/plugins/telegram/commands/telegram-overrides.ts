import type { Context } from 'grammy'
import type { OpenACPCore } from '../../../core/index.js'
import type { MenuRegistry } from '../../../core/menu-registry.js'
import { handleAgents } from './agents.js'
import { handleTopics } from './session.js'
import { handleDoctor } from './doctor.js'
import { handleUpdate, handleRestart } from './admin.js'
import { handleHelp, handleMenu } from './menu.js'

/**
 * Commands that should be intercepted and handled by Telegram-specific
 * handlers instead of going through CommandRegistry core handlers.
 *
 * These handlers use grammY Context for rich UI (inline keyboards,
 * message editing, pagination) that CommandResponse cannot express.
 */
export const TELEGRAM_OVERRIDES: Record<
  string,
  (ctx: Context, core: OpenACPCore) => Promise<void>
> = {
  agents: (ctx, core) => handleAgents(ctx, core),
  sessions: (ctx, core) => handleTopics(ctx, core),
  doctor: (ctx) => handleDoctor(ctx),
  update: (ctx, core) => handleUpdate(ctx, core),
  restart: (ctx, core) => handleRestart(ctx, core),
  help: (ctx) => handleHelp(ctx),
  menu: (ctx, core) => {
    const menuRegistry = core.lifecycleManager?.serviceRegistry?.get('menu-registry') as MenuRegistry | undefined
    return handleMenu(ctx, menuRegistry)
  },
}
