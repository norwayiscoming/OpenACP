import { describe, it, expect, vi, beforeEach } from "vitest";
import { Session } from "../session.js";
import { TypedEmitter } from "../typed-emitter.js";
import type { AgentEvent, Attachment } from "../types.js";

function mockAgentInstance(overrides: Record<string, unknown> = {}) {
  const emitter = new TypedEmitter<{
    agent_event: (event: AgentEvent) => void;
  }>();
  return Object.assign(emitter, {
    sessionId: "agent-sess-1",
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    onPermissionRequest: vi.fn(),
    promptCapabilities: {},
    ...overrides,
  }) as any;
}

function createTestSession(agentInstance?: any, opts: Record<string, unknown> = {}) {
  return new Session({
    channelId: "telegram",
    agentName: "claude",
    workingDirectory: "/workspace",
    agentInstance: agentInstance || mockAgentInstance(),
    ...opts,
  });
}

describe("Session — State Machine Exhaustive Transitions", () => {
  // Valid transitions according to source:
  // initializing -> active, error
  // active -> error, finished, cancelled
  // error -> active
  // cancelled -> active
  // finished -> (nothing)

  describe("valid transitions", () => {
    it("initializing → active via activate()", () => {
      const session = createTestSession();
      expect(session.status).toBe("initializing");
      session.activate();
      expect(session.status).toBe("active");
    });

    it("initializing → error via fail()", () => {
      const session = createTestSession();
      session.fail("init error");
      expect(session.status).toBe("error");
    });

    it("active → error via fail()", () => {
      const session = createTestSession();
      session.activate();
      session.fail("runtime error");
      expect(session.status).toBe("error");
    });

    it("active → finished via finish()", () => {
      const session = createTestSession();
      session.activate();
      session.finish("done");
      expect(session.status).toBe("finished");
    });

    it("active → cancelled via markCancelled()", () => {
      const session = createTestSession();
      session.activate();
      session.markCancelled();
      expect(session.status).toBe("cancelled");
    });

    it("error → active via activate() (recovery)", () => {
      const session = createTestSession();
      session.fail("oops");
      expect(session.status).toBe("error");
      session.activate();
      expect(session.status).toBe("active");
    });

    it("cancelled → active via activate() (resume after cancel)", () => {
      const session = createTestSession();
      session.activate();
      session.markCancelled();
      expect(session.status).toBe("cancelled");
      session.activate();
      expect(session.status).toBe("active");
    });
  });

  describe("invalid transitions throw", () => {
    it("initializing → finished throws", () => {
      const session = createTestSession();
      expect(() => session.finish()).toThrow("Invalid session transition: initializing → finished");
    });

    it("initializing → cancelled throws", () => {
      const session = createTestSession();
      expect(() => session.markCancelled()).toThrow("Invalid session transition: initializing → cancelled");
    });

    it("active → active throws (double activate)", () => {
      const session = createTestSession();
      session.activate();
      expect(() => session.activate()).toThrow("Invalid session transition: active → active");
    });

    it("finished → any throws (terminal state)", () => {
      const session = createTestSession();
      session.activate();
      session.finish("done");

      expect(() => session.activate()).toThrow("Invalid session transition: finished → active");
      expect(() => session.fail("x")).toThrow("Invalid session transition: finished → error");
      expect(() => session.finish()).toThrow("Invalid session transition: finished → finished");
      expect(() => session.markCancelled()).toThrow("Invalid session transition: finished → cancelled");
    });

    it("error → error throws (double error)", () => {
      const session = createTestSession();
      session.fail("first");
      expect(() => session.fail("second")).toThrow("Invalid session transition: error → error");
    });

    it("error → finished throws", () => {
      const session = createTestSession();
      session.fail("oops");
      expect(() => session.finish()).toThrow("Invalid session transition: error → finished");
    });

    it("error → cancelled throws", () => {
      const session = createTestSession();
      session.fail("oops");
      expect(() => session.markCancelled()).toThrow("Invalid session transition: error → cancelled");
    });

    it("cancelled → finished throws", () => {
      const session = createTestSession();
      session.activate();
      session.markCancelled();
      expect(() => session.finish()).toThrow("Invalid session transition: cancelled → finished");
    });

    it("cancelled → error throws", () => {
      const session = createTestSession();
      session.activate();
      session.markCancelled();
      expect(() => session.fail("x")).toThrow("Invalid session transition: cancelled → error");
    });

    it("cancelled → cancelled throws", () => {
      const session = createTestSession();
      session.activate();
      session.markCancelled();
      expect(() => session.markCancelled()).toThrow("Invalid session transition: cancelled → cancelled");
    });
  });

  describe("status_change events", () => {
    it("emits status_change for each transition with correct from/to", () => {
      const session = createTestSession();
      const changes: [string, string][] = [];
      session.on("status_change", (from, to) => changes.push([from, to]));

      session.activate(); // initializing → active
      session.markCancelled(); // active → cancelled
      session.activate(); // cancelled → active
      session.fail("err"); // active → error
      session.activate(); // error → active
      session.finish("done"); // active → finished

      expect(changes).toEqual([
        ["initializing", "active"],
        ["active", "cancelled"],
        ["cancelled", "active"],
        ["active", "error"],
        ["error", "active"],
        ["active", "finished"],
      ]);
    });

    it("fail() emits both status_change and error events", () => {
      const session = createTestSession();
      const errors: string[] = [];
      const changes: string[] = [];
      session.on("error", (err) => errors.push(err.message));
      session.on("status_change", (_f, t) => changes.push(t));

      session.fail("test error");

      expect(changes).toContain("error");
      expect(errors).toContain("test error");
    });

    it("finish() emits both status_change and session_end events", () => {
      const session = createTestSession();
      session.activate();
      const ends: string[] = [];
      const changes: string[] = [];
      session.on("session_end", (r) => ends.push(r));
      session.on("status_change", (_f, t) => changes.push(t));

      session.finish("all done");

      expect(changes).toContain("finished");
      expect(ends).toContain("all done");
    });

    it("finish() with no reason defaults to 'completed'", () => {
      const session = createTestSession();
      session.activate();
      const ends: string[] = [];
      session.on("session_end", (r) => ends.push(r));

      session.finish();

      expect(ends).toContain("completed");
    });
  });
});

describe("Session — Prompt Processing Flows", () => {
  it("first prompt auto-activates from initializing", async () => {
    const session = createTestSession();
    expect(session.status).toBe("initializing");

    await session.enqueuePrompt("hello");

    expect(session.status).toBe("active");
  });

  it("subsequent prompts do not re-activate already active session", async () => {
    const session = createTestSession();
    const changes: [string, string][] = [];
    session.on("status_change", (from, to) => changes.push([from, to]));
    session.name = "skip-autoname";

    await session.enqueuePrompt("first");
    await session.enqueuePrompt("second");

    // Only one activation, not two
    const activations = changes.filter(([, to]) => to === "active");
    expect(activations).toHaveLength(1);
  });

  it("passes attachments to agent", async () => {
    const agent = mockAgentInstance();
    const session = createTestSession(agent);
    session.name = "skip";

    const att: Attachment = {
      type: "image",
      filePath: "/tmp/img.png",
      fileName: "img.png",
      mimeType: "image/png",
      size: 1024,
    };

    await session.enqueuePrompt("look at this", [att]);

    expect(agent.prompt).toHaveBeenCalledWith("look at this", [att]);
  });

  it("warmup sentinel is not forwarded to agent as a regular prompt", async () => {
    const agent = mockAgentInstance();
    const session = createTestSession(agent);

    await session.warmup();

    // Warmup sends 'Reply with only "ready".' not the sentinel
    expect(agent.prompt).toHaveBeenCalledWith(
      expect.stringContaining("ready"),
    );
    expect(agent.prompt).not.toHaveBeenCalledWith("\x00__warmup__");
  });

  it("warmup then user prompt processes in correct order", async () => {
    const agent = mockAgentInstance();
    const order: string[] = [];
    agent.prompt.mockImplementation(async (text: string) => {
      if (text.includes("ready")) order.push("warmup");
      else order.push(`user:${text}`);
    });

    const session = createTestSession(agent);
    session.name = "skip";

    // Fire warmup and immediately enqueue a user prompt
    const w = session.warmup();
    const p = session.enqueuePrompt("hello");

    await Promise.all([w, p]);

    expect(order[0]).toBe("warmup");
    expect(order[1]).toBe("user:hello");
  });

  it("queueDepth reflects pending items", async () => {
    let resolveFirst!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const agent = mockAgentInstance();
    agent.prompt.mockImplementation(async (text: string) => {
      if (text === "first") await blocker;
    });

    const session = createTestSession(agent);
    session.name = "skip";

    const p1 = session.enqueuePrompt("first");
    session.enqueuePrompt("second");
    session.enqueuePrompt("third");

    // first is processing, second and third are queued
    expect(session.queueDepth).toBe(2);
    expect(session.promptRunning).toBe(true);

    resolveFirst();
    await p1;
    // Let the queue drain
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("Session — Auto-naming", () => {
  it("pauses agent_event during auto-name so events don't leak to adapter", async () => {
    const agent = mockAgentInstance();
    const events: AgentEvent[] = [];

    agent.prompt.mockImplementation(async (text: string) => {
      if (text.includes("Summarize")) {
        // These should be swallowed
        agent.emit("agent_event", { type: "text", content: "Title" });
        agent.emit("agent_event", { type: "thought", content: "thinking" });
      }
    });

    const session = createTestSession(agent);
    session.on("agent_event", (e) => events.push(e));

    await session.enqueuePrompt("hello");

    // No auto-name events should have leaked through
    const autoNameEvents = events.filter(
      (e) =>
        (e.type === "text" && e.content === "Title") ||
        (e.type === "thought" && e.content === "thinking"),
    );
    expect(autoNameEvents).toHaveLength(0);
  });

  it("resumes normal event delivery after auto-name", async () => {
    const agent = mockAgentInstance();
    const session = createTestSession(agent);

    await session.enqueuePrompt("hello");

    // After auto-name, session should not be paused
    expect(session.isPaused).toBe(false);

    // Subsequent events should be delivered normally
    const events: AgentEvent[] = [];
    session.on("agent_event", (e) => events.push(e));
    session.emit("agent_event", { type: "text", content: "normal" });
    expect(events).toHaveLength(1);
  });

  it("only auto-names once even with multiple prompts", async () => {
    const agent = mockAgentInstance();
    agent.prompt.mockImplementation(async (text: string) => {
      if (text.includes("Summarize")) {
        agent.emit("agent_event", { type: "text", content: "My Title" });
      }
    });

    const session = createTestSession(agent);
    const names: string[] = [];
    session.on("named", (n) => names.push(n));

    await session.enqueuePrompt("first");
    await session.enqueuePrompt("second");

    // prompt called: first + autoname + second = 3
    expect(agent.prompt).toHaveBeenCalledTimes(3);
    // But only one named event
    expect(names).toHaveLength(1);
    expect(names[0]).toBe("My Title");
  });
});

describe("Session — Audio Transcription (STT)", () => {
  function mockSpeechService(transcription = "hello world") {
    return {
      isSTTAvailable: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockResolvedValue({
        text: transcription,
        duration: 2.5,
      }),
    } as any;
  }

  it("transcribes audio when agent lacks audio capability", async () => {
    const agent = mockAgentInstance({ promptCapabilities: {} });
    const speech = mockSpeechService("transcribed text");
    const session = createTestSession(agent, { speechService: speech });
    session.name = "skip";

    const audioAtt: Attachment = {
      type: "audio",
      filePath: "/tmp/voice.ogg",
      fileName: "voice.ogg",
      mimeType: "audio/ogg",
      size: 5000,
    };

    // Mock fs.promises.readFile
    const fsModule = await import("node:fs");
    vi.spyOn(fsModule.promises, "readFile").mockResolvedValue(Buffer.from("fake-audio"));

    await session.enqueuePrompt("[Audio: voice.ogg]", [audioAtt]);

    expect(speech.transcribe).toHaveBeenCalled();
    // Agent should receive the transcribed text, not the placeholder
    expect(agent.prompt).toHaveBeenCalledWith(
      expect.stringContaining("transcribed text"),
      undefined, // audio attachment removed since it was transcribed
    );

    vi.restoreAllMocks();
  });

  it("skips transcription when agent has audio capability", async () => {
    const agent = mockAgentInstance({
      promptCapabilities: { audio: true },
    });
    const speech = mockSpeechService();
    const session = createTestSession(agent, { speechService: speech });
    session.name = "skip";

    const audioAtt: Attachment = {
      type: "audio",
      filePath: "/tmp/voice.ogg",
      fileName: "voice.ogg",
      mimeType: "audio/ogg",
      size: 5000,
    };

    await session.enqueuePrompt("listen", [audioAtt]);

    expect(speech.transcribe).not.toHaveBeenCalled();
    expect(agent.prompt).toHaveBeenCalledWith("listen", [audioAtt]);
  });

  it("skips transcription when no speech service", async () => {
    const agent = mockAgentInstance();
    const session = createTestSession(agent);
    session.name = "skip";

    const audioAtt: Attachment = {
      type: "audio",
      filePath: "/tmp/voice.ogg",
      fileName: "voice.ogg",
      mimeType: "audio/ogg",
      size: 5000,
    };

    await session.enqueuePrompt("listen", [audioAtt]);

    // Should pass through without modification
    expect(agent.prompt).toHaveBeenCalledWith("listen", [audioAtt]);
  });

  it("keeps non-audio attachments intact during transcription", async () => {
    const agent = mockAgentInstance({ promptCapabilities: {} });
    const speech = mockSpeechService("hello");
    const session = createTestSession(agent, { speechService: speech });
    session.name = "skip";

    const imageAtt: Attachment = {
      type: "image",
      filePath: "/tmp/img.png",
      fileName: "img.png",
      mimeType: "image/png",
      size: 1000,
    };
    const audioAtt: Attachment = {
      type: "audio",
      filePath: "/tmp/voice.ogg",
      fileName: "voice.ogg",
      mimeType: "audio/ogg",
      size: 5000,
    };

    const fsModule = await import("node:fs");
    vi.spyOn(fsModule.promises, "readFile").mockResolvedValue(Buffer.from("fake"));

    await session.enqueuePrompt("check this", [imageAtt, audioAtt]);

    // Image should remain, audio should be removed (transcribed)
    expect(agent.prompt).toHaveBeenCalledWith(
      expect.stringContaining("hello"),
      [imageAtt],
    );

    vi.restoreAllMocks();
  });

  it("emits system_message with transcription result", async () => {
    const agent = mockAgentInstance({ promptCapabilities: {} });
    const speech = mockSpeechService("hello world");
    const session = createTestSession(agent, { speechService: speech });
    session.name = "skip";

    const events: AgentEvent[] = [];
    session.on("agent_event", (e) => events.push(e));

    const audioAtt: Attachment = {
      type: "audio",
      filePath: "/tmp/voice.ogg",
      fileName: "voice.ogg",
      mimeType: "audio/ogg",
      size: 5000,
    };

    const fsModule = await import("node:fs");
    vi.spyOn(fsModule.promises, "readFile").mockResolvedValue(Buffer.from("fake"));

    await session.enqueuePrompt("[Audio: voice.ogg]", [audioAtt]);

    const sysMsg = events.find((e) => e.type === "system_message");
    expect(sysMsg).toBeDefined();
    expect((sysMsg as any).message).toContain("hello world");

    vi.restoreAllMocks();
  });

  it("falls back to keeping audio attachment on transcription error", async () => {
    const agent = mockAgentInstance({ promptCapabilities: {} });
    const speech = {
      isSTTAvailable: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockRejectedValue(new Error("STT failed")),
    } as any;
    const session = createTestSession(agent, { speechService: speech });
    session.name = "skip";

    const audioAtt: Attachment = {
      type: "audio",
      filePath: "/tmp/voice.ogg",
      fileName: "voice.ogg",
      mimeType: "audio/ogg",
      size: 5000,
    };

    const fsModule = await import("node:fs");
    vi.spyOn(fsModule.promises, "readFile").mockResolvedValue(Buffer.from("fake"));

    const events: AgentEvent[] = [];
    session.on("agent_event", (e) => events.push(e));

    await session.enqueuePrompt("listen", [audioAtt]);

    // Audio attachment should be preserved on error
    expect(agent.prompt).toHaveBeenCalledWith("listen", [audioAtt]);
    // Error event should have been emitted
    const errEvt = events.find((e) => e.type === "error");
    expect(errEvt).toBeDefined();

    vi.restoreAllMocks();
  });

  it("skips transcription when STT is not available", async () => {
    const agent = mockAgentInstance({ promptCapabilities: {} });
    const speech = {
      isSTTAvailable: vi.fn().mockReturnValue(false),
      transcribe: vi.fn(),
    } as any;
    const session = createTestSession(agent, { speechService: speech });
    session.name = "skip";

    const audioAtt: Attachment = {
      type: "audio",
      filePath: "/tmp/voice.ogg",
      fileName: "voice.ogg",
      mimeType: "audio/ogg",
      size: 5000,
    };

    await session.enqueuePrompt("listen", [audioAtt]);

    expect(speech.transcribe).not.toHaveBeenCalled();
  });
});

describe("Session — Abort and Destroy", () => {
  it("abortPrompt clears queue and cancels agent", async () => {
    const agent = mockAgentInstance();
    const session = createTestSession(agent);
    session.activate();

    await session.abortPrompt();

    expect(agent.cancel).toHaveBeenCalled();
  });

  it("destroy calls agent destroy", async () => {
    const agent = mockAgentInstance();
    const session = createTestSession(agent);

    await session.destroy();

    expect(agent.destroy).toHaveBeenCalled();
  });

  it("abortPrompt during processing aborts current and clears pending", async () => {
    let resolveFirst!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const agent = mockAgentInstance();
    const processedTexts: string[] = [];
    agent.prompt.mockImplementation(async (text: string) => {
      processedTexts.push(text);
      if (text === "first") await blocker;
    });

    const session = createTestSession(agent);
    session.name = "skip";

    const p1 = session.enqueuePrompt("first");
    session.enqueuePrompt("second");

    // Abort while first is processing
    await session.abortPrompt();
    resolveFirst();
    await p1.catch(() => {});

    // 'second' should never have been processed
    expect(processedTexts).not.toContain("second");
  });
});

describe("Session — Error Handling in Prompt", () => {
  it("prompt error transitions to error status", async () => {
    const agent = mockAgentInstance();
    agent.prompt.mockRejectedValue(new Error("agent crashed"));
    const session = createTestSession(agent);

    await session.enqueuePrompt("hello");

    expect(session.status).toBe("error");
  });

  it("error in one prompt does not prevent next prompt", async () => {
    const agent = mockAgentInstance();
    let callCount = 0;
    agent.prompt.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("first fails");
    });

    const session = createTestSession(agent);
    session.name = "skip";

    await session.enqueuePrompt("first");
    expect(session.status).toBe("error");

    // Recovery: error → active is valid
    session.activate();
    await session.enqueuePrompt("second");
    // first fails (call 1), second succeeds (call 2) - no autoname since name is set
    expect(callCount).toBe(2);
  });
});
