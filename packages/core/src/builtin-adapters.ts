// Built-in adapter loader.
// Telegram adapter is bundled as a separate entry point by tsup (adapter-telegram.js).
// In dev: falls back to relative path to compiled dist.

export async function getTelegramAdapter() {
  try {
    // Published bundle: adapter-telegram.js is a sibling file in dist/
    const mod = await import(new URL('./adapter-telegram.js', import.meta.url).href)
    return mod.TelegramAdapter
  } catch {
    // Dev mode: resolve from workspace compiled dist
    const mod = await import(new URL('../../adapters/telegram/dist/index.js', import.meta.url).href)
    return mod.TelegramAdapter
  }
}
