import { describe, it, expect } from 'vitest'
import { ConfigSchema, ConfigManager } from '../core/config/config.js'

describe('ConfigSchema - runMode and autoStart', () => {
  const baseConfig = {
    defaultAgent: 'claude',
  }

  it('defaults runMode to foreground', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.runMode).toBe('foreground')
  })

  it('defaults autoStart to false', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.autoStart).toBe(false)
  })

  it('accepts runMode daemon', () => {
    const result = ConfigSchema.parse({ ...baseConfig, runMode: 'daemon' })
    expect(result.runMode).toBe('daemon')
  })

  it('accepts autoStart true', () => {
    const result = ConfigSchema.parse({ ...baseConfig, autoStart: true })
    expect(result.autoStart).toBe(true)
  })

  it('rejects invalid runMode', () => {
    expect(() => ConfigSchema.parse({ ...baseConfig, runMode: 'invalid' })).toThrow()
  })
})

describe('ConfigManager.get() immutability', () => {
  it('returns a clone — mutating result does not affect internal config', async () => {
    const mgr = new ConfigManager()
    // Manually set config via private field for isolated unit test
    ;(mgr as any).config = ConfigSchema.parse({
      defaultAgent: 'claude',
    })

    const config1 = mgr.get()
    config1.defaultAgent = 'MUTATED'

    const config2 = mgr.get()
    expect(config2.defaultAgent).toBe('claude')
  })
})
