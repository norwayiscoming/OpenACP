import type { FieldDef } from './types.js'

/**
 * Central registry for plugin-declared editable fields.
 * Registered as service 'field-registry' in main.ts.
 */
export class PluginFieldRegistry {
  private fields = new Map<string, FieldDef[]>()

  register(pluginName: string, fields: FieldDef[]): void {
    this.fields.set(pluginName, fields)
  }

  getForPlugin(pluginName: string): FieldDef[] {
    return this.fields.get(pluginName) ?? []
  }

  getAll(): Map<string, FieldDef[]> {
    return new Map(this.fields)
  }
}
