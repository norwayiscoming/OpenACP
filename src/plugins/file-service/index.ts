import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import { FileService } from './file-service.js'
import path from 'node:path'
import os from 'node:os'

function createFileServicePlugin(): OpenACPPlugin {
  return {
    name: '@openacp/file-service',
    version: '1.0.0',
    description: 'File storage and management for session attachments',
    essential: false,
    permissions: ['services:register'],

    async install(ctx: InstallContext) {
      const { settings, legacyConfig, terminal } = ctx

      // Migrate from legacy config if present
      if (legacyConfig) {
        const filesCfg = legacyConfig.files as Record<string, unknown> | undefined
        if (filesCfg) {
          await settings.setAll({
            baseDir: filesCfg.baseDir ?? path.join(os.homedir(), '.openacp', 'files'),
          })
          terminal.log.success('File service settings migrated from legacy config')
          return
        }
      }

      // Save defaults
      await settings.setAll({
        baseDir: path.join(os.homedir(), '.openacp', 'files'),
      })
      terminal.log.success('File service defaults saved')
    },

    async configure(ctx: InstallContext) {
      const { terminal, settings } = ctx
      const current = await settings.getAll()

      const val = await terminal.text({
        message: 'File storage directory:',
        defaultValue: (current.baseDir as string) ?? path.join(os.homedir(), '.openacp', 'files'),
      })
      await settings.set('baseDir', val.trim())
      terminal.log.success('File storage directory updated')
    },

    async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
      if (opts.purge) {
        await ctx.settings.clear()
        ctx.terminal.log.success('File service settings cleared')
      }
    },

    async setup(ctx) {
      const config = ctx.pluginConfig as Record<string, unknown>
      const baseDir = (config.baseDir as string) ?? path.join(os.homedir(), '.openacp', 'files')
      const service = new FileService(baseDir)
      ctx.registerService('file-service', service)
      ctx.log.info('File service ready')
    },
  }
}

export default createFileServicePlugin()
