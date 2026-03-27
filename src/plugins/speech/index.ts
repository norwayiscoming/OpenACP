import type { OpenACPPlugin, InstallContext } from '../../core/plugin/types.js'
import { SpeechService, GroqSTT, EdgeTTS } from './exports.js'
import type { SpeechServiceConfig } from './exports.js'

const speechPlugin: OpenACPPlugin = {
  name: '@openacp/speech',
  version: '1.0.0',
  description: 'Text-to-speech and speech-to-text with pluggable providers',
  essential: false,
  optionalPluginDependencies: { '@openacp/file-service': '^1.0.0' },
  permissions: ['services:register', 'commands:register'],

  async install(ctx: InstallContext) {
    const { terminal, settings, legacyConfig } = ctx

    // Migrate from legacy config if present
    if (legacyConfig) {
      const speechCfg = legacyConfig.speech as Record<string, unknown> | undefined
      if (speechCfg) {
        const stt = speechCfg.stt as Record<string, unknown> | undefined
        const tts = speechCfg.tts as Record<string, unknown> | undefined
        const groqProviders = stt?.providers as Record<string, unknown> | undefined
        const groqConfig = groqProviders?.groq as Record<string, unknown> | undefined
        await settings.setAll({
          sttProvider: stt?.provider ?? null,
          groqApiKey: groqConfig?.apiKey ?? '',
          ttsProvider: tts?.provider ?? 'edge-tts',
          ttsVoice: '',
        })
        terminal.log.success('Speech settings migrated from legacy config')
        return
      }
    }

    // Interactive setup
    const enableStt = await terminal.confirm({
      message: 'Enable speech-to-text (STT)?',
      initialValue: false,
    })

    let sttProvider: string | null = null
    let groqApiKey = ''

    if (enableStt) {
      sttProvider = await terminal.select({
        message: 'STT provider:',
        options: [{ value: 'groq', label: 'Groq (Whisper)', hint: 'Fast and affordable' }],
      })

      if (sttProvider === 'groq') {
        groqApiKey = await terminal.text({
          message: 'Groq API key:',
          validate: (v) => (!v.trim() ? 'API key cannot be empty' : undefined),
        })
        groqApiKey = groqApiKey.trim()
      }
    }

    const ttsProvider = await terminal.select({
      message: 'TTS provider:',
      options: [
        { value: 'edge-tts', label: 'Edge TTS', hint: 'Free, good quality' },
        { value: 'none', label: 'None (disable TTS)' },
      ],
    })

    let ttsVoice = ''
    if (ttsProvider === 'edge-tts') {
      ttsVoice = await terminal.text({
        message: 'TTS voice (leave blank for default):',
        placeholder: 'e.g. en-US-AriaNeural',
      })
      ttsVoice = ttsVoice.trim()
    }

    await settings.setAll({
      sttProvider,
      groqApiKey,
      ttsProvider: ttsProvider === 'none' ? null : ttsProvider,
      ttsVoice,
    })
    terminal.log.success('Speech settings saved')
  },

  async configure(ctx: InstallContext) {
    const { terminal, settings } = ctx
    const current = await settings.getAll()

    const choice = await terminal.select({
      message: 'What to configure?',
      options: [
        { value: 'stt', label: 'Change STT provider/key' },
        { value: 'tts', label: 'Change TTS provider/voice' },
        { value: 'done', label: 'Done' },
      ],
    })

    if (choice === 'stt') {
      const key = await terminal.text({
        message: 'Groq API key (leave blank to disable STT):',
        defaultValue: (current.groqApiKey as string) ?? '',
      })
      const trimmed = key.trim()
      await settings.set('sttProvider', trimmed ? 'groq' : null)
      await settings.set('groqApiKey', trimmed)
      terminal.log.success('STT settings updated')
    } else if (choice === 'tts') {
      const voice = await terminal.text({
        message: 'TTS voice (leave blank for default):',
        defaultValue: (current.ttsVoice as string) ?? '',
      })
      await settings.set('ttsVoice', voice.trim())
      terminal.log.success('TTS settings updated')
    }
  },

  async uninstall(ctx: InstallContext, opts: { purge: boolean }) {
    if (opts.purge) {
      await ctx.settings.clear()
      ctx.terminal.log.success('Speech settings cleared')
    }
  },

  async setup(ctx) {
    const config = ctx.pluginConfig as Record<string, unknown>
    const groqApiKey = config.groqApiKey as string | undefined
    const ttsVoice = config.ttsVoice as string | undefined

    const sttProvider = groqApiKey ? 'groq' : null
    const speechConfig: SpeechServiceConfig = {
      stt: {
        provider: sttProvider,
        providers: groqApiKey ? { groq: { apiKey: groqApiKey } } : {},
      },
      tts: {
        provider: 'edge-tts',
        providers: {},
      },
    }

    const service = new SpeechService(speechConfig)

    if (groqApiKey) {
      service.registerSTTProvider('groq', new GroqSTT(groqApiKey))
    }
    service.registerTTSProvider('edge-tts', new EdgeTTS(ttsVoice))

    // Register provider factory for hot-reload (core calls refreshProviders on config change)
    service.setProviderFactory((cfg) => {
      const sttMap = new Map<string, InstanceType<typeof GroqSTT>>()
      const ttsMap = new Map<string, InstanceType<typeof EdgeTTS>>()
      const groqCfg = cfg.stt?.providers?.groq
      if (groqCfg?.apiKey) {
        sttMap.set('groq', new GroqSTT(groqCfg.apiKey, groqCfg.model))
      }
      const edgeVoice = cfg.tts?.providers?.['edge-tts']?.voice as string | undefined
      ttsMap.set('edge-tts', new EdgeTTS(edgeVoice))
      return { stt: sttMap, tts: ttsMap }
    })

    ctx.registerService('speech', service)

    ctx.registerCommand({
      name: 'tts',
      description: 'Toggle text-to-speech',
      usage: 'on|off',
      category: 'plugin',
      handler: async (args) => {
        const mode = args.raw.trim().toLowerCase()
        if (mode === 'on') return { type: 'text', text: 'Text-to-speech enabled' }
        if (mode === 'off') return { type: 'text', text: 'Text-to-speech disabled' }
        return { type: 'menu', title: 'Text to Speech', options: [
          { label: 'Enable', command: '/tts on' },
          { label: 'Disable', command: '/tts off' },
        ]}
      },
    })

    ctx.log.info('Speech service ready')
  },
}

export default speechPlugin
