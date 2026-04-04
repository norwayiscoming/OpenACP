import type { MenuItem } from './plugin/types.js'
import { createChildLogger } from './utils/log.js'

const log = createChildLogger({ module: 'menu-registry' })

export { type MenuItem }

export class MenuRegistry {
  private items = new Map<string, MenuItem>()

  register(item: MenuItem): void {
    this.items.set(item.id, item)
  }

  unregister(id: string): void {
    this.items.delete(id)
  }

  getItem(id: string): MenuItem | undefined {
    return this.items.get(id)
  }

  /** Get all visible items sorted by priority */
  getItems(): MenuItem[] {
    return [...this.items.values()]
      .filter((item) => {
        if (!item.visible) return true
        try {
          return item.visible()
        } catch (err) {
          log.warn({ err, id: item.id }, 'MenuItem visible() threw, hiding item')
          return false
        }
      })
      .sort((a, b) => a.priority - b.priority)
  }
}
