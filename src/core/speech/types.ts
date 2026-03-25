export interface STTOptions {
  language?: string;
  model?: string;
}

export interface STTResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface TTSOptions {
  language?: string;
  voice?: string;
  model?: string;
}

export interface TTSResult {
  audioBuffer: Buffer;
  mimeType: string;
}

export interface STTProvider {
  readonly name: string;
  transcribe(audioBuffer: Buffer, mimeType: string, options?: STTOptions): Promise<STTResult>;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;
}

export interface SpeechProviderConfig {
  apiKey?: string;
  model?: string;
  [key: string]: unknown;
}

export interface SpeechServiceConfig {
  stt: {
    provider: string | null;
    providers: Record<string, SpeechProviderConfig>;
  };
  tts: {
    provider: string | null;
    providers: Record<string, SpeechProviderConfig>;
  };
}
