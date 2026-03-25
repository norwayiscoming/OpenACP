import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileService } from "../file-service.js";

describe("FileService", () => {
  let service: FileService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openacp-test-"));
    service = new FileService(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("saveFile", () => {
    it("saves file and returns Attachment with correct metadata", async () => {
      const data = Buffer.from("hello world");
      const att = await service.saveFile("s1", "test.txt", data, "text/plain");

      expect(att.type).toBe("file");
      expect(att.fileName).toBe("test.txt");
      expect(att.mimeType).toBe("text/plain");
      expect(att.size).toBe(11);
      expect(fs.existsSync(att.filePath)).toBe(true);
      expect(fs.readFileSync(att.filePath).toString()).toBe("hello world");
    });

    it("saves image with correct type", async () => {
      const att = await service.saveFile("s1", "photo.png", Buffer.from("x"), "image/png");
      expect(att.type).toBe("image");
    });

    it("saves audio with correct type", async () => {
      const att = await service.saveFile("s1", "voice.ogg", Buffer.from("x"), "audio/ogg");
      expect(att.type).toBe("audio");
    });

    it("creates session subdirectory", async () => {
      const att = await service.saveFile("session-abc", "f.txt", Buffer.from("x"), "text/plain");
      expect(att.filePath).toContain("session-abc");
    });
  });

  describe("resolveFile", () => {
    it("returns Attachment for existing file", async () => {
      const filePath = path.join(tmpDir, "test.jpg");
      fs.writeFileSync(filePath, "fake jpeg");

      const att = await service.resolveFile(filePath);
      expect(att).not.toBeNull();
      expect(att!.type).toBe("image");
      expect(att!.mimeType).toBe("image/jpeg");
      expect(att!.size).toBe(9);
    });

    it("returns null for non-existent file", async () => {
      const att = await service.resolveFile("/nonexistent/file.txt");
      expect(att).toBeNull();
    });
  });

  describe("extensionFromMime", () => {
    it("maps common image types", () => {
      expect(FileService.extensionFromMime("image/jpeg")).toBe(".jpg");
      expect(FileService.extensionFromMime("image/png")).toBe(".png");
      expect(FileService.extensionFromMime("image/webp")).toBe(".webp");
    });

    it("maps common audio types", () => {
      expect(FileService.extensionFromMime("audio/ogg")).toBe(".ogg");
      expect(FileService.extensionFromMime("audio/mpeg")).toBe(".mp3");
    });

    it("returns .bin for unknown types", () => {
      expect(FileService.extensionFromMime("application/octet-stream")).toBe(".bin");
    });
  });
});
