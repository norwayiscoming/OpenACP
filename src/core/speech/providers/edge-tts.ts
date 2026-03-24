import type { TTSProvider, TTSOptions, TTSResult } from '../types.js';

const DEFAULT_VOICE = "en-US-AriaNeural";

export class EdgeTTS implements TTSProvider {
  readonly name = "edge-tts";
  private voice: string;

  constructor(voice?: string) {
    this.voice = voice || DEFAULT_VOICE;
  }

  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS();

    const voice = options?.voice || this.voice;
    const format = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

    await tts.setMetadata(voice, format);
    const { audioStream } = tts.toStream(text);

    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    tts.close();

    return {
      audioBuffer: Buffer.concat(chunks),
      mimeType: "audio/mpeg",
    };
  }
}
