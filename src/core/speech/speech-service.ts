import type { STTProvider, TTSProvider, STTOptions, STTResult, TTSOptions, TTSResult, SpeechServiceConfig } from './types.js';

export class SpeechService {
  private sttProviders = new Map<string, STTProvider>();
  private ttsProviders = new Map<string, TTSProvider>();

  constructor(private config: SpeechServiceConfig) {}

  registerSTTProvider(name: string, provider: STTProvider): void {
    this.sttProviders.set(name, provider);
  }

  registerTTSProvider(name: string, provider: TTSProvider): void {
    this.ttsProviders.set(name, provider);
  }

  isSTTAvailable(): boolean {
    const { provider, providers } = this.config.stt;
    return provider !== null && providers[provider]?.apiKey !== undefined;
  }

  isTTSAvailable(): boolean {
    const provider = this.config.tts.provider;
    return provider !== null && this.ttsProviders.has(provider);
  }

  async transcribe(audioBuffer: Buffer, mimeType: string, options?: STTOptions): Promise<STTResult> {
    const providerName = this.config.stt.provider;
    if (!providerName || !this.config.stt.providers[providerName]?.apiKey) {
      throw new Error("STT not configured. Set speech.stt.provider and API key in config.");
    }
    const provider = this.sttProviders.get(providerName);
    if (!provider) {
      throw new Error(`STT provider "${providerName}" not registered. Available: ${[...this.sttProviders.keys()].join(", ") || "none"}`);
    }
    return provider.transcribe(audioBuffer, mimeType, options);
  }

  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    const providerName = this.config.tts.provider;
    if (!providerName) {
      throw new Error("TTS not configured. Set speech.tts.provider in config.");
    }
    const provider = this.ttsProviders.get(providerName);
    if (!provider) {
      throw new Error(`TTS provider "${providerName}" not registered. Available: ${[...this.ttsProviders.keys()].join(", ") || "none"}`);
    }
    return provider.synthesize(text, options);
  }

  updateConfig(config: SpeechServiceConfig): void {
    this.config = config;
  }
}
