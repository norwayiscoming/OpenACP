import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";

const mockSetMetadata = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn();

function createMockAudioStream(data: Buffer): Readable {
  return new Readable({
    read() {
      this.push(data);
      this.push(null);
    },
  });
}

const mockToStream = vi.fn();

class MockMsEdgeTTS {
  setMetadata = mockSetMetadata;
  toStream = mockToStream;
  close = mockClose;
}

vi.mock("msedge-tts", () => ({
  MsEdgeTTS: MockMsEdgeTTS,
  OUTPUT_FORMAT: {
    AUDIO_24KHZ_48KBITRATE_MONO_MP3: "audio-24khz-48kbitrate-mono-mp3",
    AUDIO_24KHZ_96KBITRATE_MONO_MP3: "audio-24khz-96kbitrate-mono-mp3",
    WEBM_24KHZ_16BIT_MONO_OPUS: "webm-24khz-16bit-mono-opus",
  },
}));

// Import after mock setup
import { EdgeTTS } from "../speech/providers/edge-tts.js";

describe("EdgeTTS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToStream.mockImplementation(() => ({
      audioStream: createMockAudioStream(Buffer.from("fake-audio-data")),
      metadataStream: null,
    }));
  });

  it("has name 'edge-tts'", () => {
    const provider = new EdgeTTS();
    expect(provider.name).toBe("edge-tts");
  });

  it("uses default voice when none specified", async () => {
    const provider = new EdgeTTS();
    await provider.synthesize("hello");

    expect(mockSetMetadata).toHaveBeenCalledWith(
      "en-US-AriaNeural",
      "audio-24khz-48kbitrate-mono-mp3",
    );
    expect(mockToStream).toHaveBeenCalledWith("hello");
  });

  it("accepts custom voice in constructor", async () => {
    const provider = new EdgeTTS("vi-VN-HoaiMyNeural");
    await provider.synthesize("xin chao");

    expect(mockSetMetadata).toHaveBeenCalledWith(
      "vi-VN-HoaiMyNeural",
      "audio-24khz-48kbitrate-mono-mp3",
    );
  });

  it("uses voice from options over constructor voice", async () => {
    const provider = new EdgeTTS("en-US-AriaNeural");
    await provider.synthesize("test", { voice: "en-GB-SoniaNeural" });

    expect(mockSetMetadata).toHaveBeenCalledWith(
      "en-GB-SoniaNeural",
      "audio-24khz-48kbitrate-mono-mp3",
    );
  });

  it("returns audio buffer with correct mime type", async () => {
    const provider = new EdgeTTS();
    const result = await provider.synthesize("hello world");

    expect(result.mimeType).toBe("audio/mpeg");
    expect(Buffer.isBuffer(result.audioBuffer)).toBe(true);
    expect(result.audioBuffer.length).toBeGreaterThan(0);
  });

  it("closes the TTS instance after synthesis", async () => {
    const provider = new EdgeTTS();
    await provider.synthesize("hello");

    expect(mockClose).toHaveBeenCalled();
  });
});
