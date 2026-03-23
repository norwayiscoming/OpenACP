import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createChildLogger } from "./log.js";
import type { InstalledAgent, RegistryAgent, InstallProgress, InstallResult } from "./types.js";
import { getAgentAlias, checkDependencies, checkRuntimeAvailable, getAgentSetup } from "./agent-dependencies.js";
import { AgentStore } from "./agent-store.js";

const log = createChildLogger({ module: "agent-installer" });

const AGENTS_DIR = path.join(os.homedir(), ".openacp", "agents");

const ARCH_MAP: Record<string, string> = {
  arm64: "aarch64",
  x64: "x86_64",
};

const PLATFORM_MAP: Record<string, string> = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

export function getPlatformKey(): string {
  const platform = PLATFORM_MAP[process.platform] ?? process.platform;
  const arch = ARCH_MAP[process.arch] ?? process.arch;
  return `${platform}-${arch}`;
}

export type ResolvedDistribution =
  | { type: "npx"; package: string; args: string[]; env?: Record<string, string> }
  | { type: "uvx"; package: string; args: string[]; env?: Record<string, string> }
  | { type: "binary"; archive: string; cmd: string; args: string[]; env?: Record<string, string> };

export function resolveDistribution(agent: RegistryAgent): ResolvedDistribution | null {
  const dist = agent.distribution;

  if (dist.npx) {
    return { type: "npx", package: dist.npx.package, args: dist.npx.args ?? [], env: dist.npx.env };
  }
  if (dist.uvx) {
    return { type: "uvx", package: dist.uvx.package, args: dist.uvx.args ?? [], env: dist.uvx.env };
  }
  if (dist.binary) {
    const platformKey = getPlatformKey();
    const target = dist.binary[platformKey];
    if (!target) return null;
    return { type: "binary", archive: target.archive, cmd: target.cmd, args: target.args ?? [], env: target.env };
  }
  return null;
}

export function buildInstalledAgent(
  registryId: string,
  name: string,
  version: string,
  dist: ResolvedDistribution,
  binaryPath?: string,
): InstalledAgent {
  if (dist.type === "npx") {
    return {
      registryId, name, version, distribution: "npx",
      command: "npx", args: [dist.package, ...dist.args],
      env: dist.env ?? {}, installedAt: new Date().toISOString(), binaryPath: null,
    };
  }
  if (dist.type === "uvx") {
    return {
      registryId, name, version, distribution: "uvx",
      command: "uvx", args: [dist.package, ...dist.args],
      env: dist.env ?? {}, installedAt: new Date().toISOString(), binaryPath: null,
    };
  }
  // binary
  const absCmd = path.resolve(binaryPath!, dist.cmd);
  return {
    registryId, name, version, distribution: "binary",
    command: absCmd, args: dist.args,
    env: dist.env ?? {}, installedAt: new Date().toISOString(), binaryPath: binaryPath!,
  };
}

export async function installAgent(
  agent: RegistryAgent,
  store: AgentStore,
  progress?: InstallProgress,
): Promise<InstallResult> {
  const agentKey = getAgentAlias(agent.id);
  await progress?.onStart(agent.id, agent.name);

  // 1. Check dependencies
  await progress?.onStep("Checking requirements...");
  const depResult = checkDependencies(agent.id);
  if (!depResult.available) {
    const hints = depResult.missing!.map((m) => `  ${m.label}: ${m.installHint}`).join("\n");
    const msg = `${agent.name} needs some tools installed first:\n${hints}`;
    await progress?.onError(msg);
    return { ok: false, agentKey, error: msg };
  }

  // 2. Resolve distribution
  const dist = resolveDistribution(agent);
  if (!dist) {
    const platformKey = getPlatformKey();
    const msg = `${agent.name} is not available for your system (${platformKey}). Check their website for other install options.`;
    await progress?.onError(msg);
    return { ok: false, agentKey, error: msg };
  }

  // 3. Check runtime
  if (dist.type === "uvx" && !checkRuntimeAvailable("uvx")) {
    const msg = `${agent.name} requires Python's uvx tool.\nInstall it with: pip install uv`;
    await progress?.onError(msg, "pip install uv");
    return { ok: false, agentKey, error: msg, hint: "pip install uv" };
  }

  // 4. Install based on type
  let binaryPath: string | undefined;

  if (dist.type === "binary") {
    try {
      binaryPath = await downloadAndExtract(agent.id, dist.archive, progress);
    } catch (err) {
      const msg = `Failed to download ${agent.name}. Please try again or install manually.`;
      await progress?.onError(msg);
      return { ok: false, agentKey, error: msg };
    }
  } else {
    await progress?.onStep("Setting up... (will download on first use)");
  }

  // 5. Save to store
  const installed = buildInstalledAgent(agent.id, agent.name, agent.version, dist, binaryPath);
  store.addAgent(agentKey, installed);

  const setup = getAgentSetup(agent.id);
  await progress?.onSuccess(agent.name);
  return { ok: true, agentKey, setupSteps: setup?.setupSteps };
}

async function downloadAndExtract(
  agentId: string,
  archiveUrl: string,
  progress?: InstallProgress,
): Promise<string> {
  const destDir = path.join(AGENTS_DIR, agentId);
  fs.mkdirSync(destDir, { recursive: true });

  await progress?.onStep("Downloading...");
  log.info({ agentId, url: archiveUrl }, "Downloading agent binary");

  const response = await fetch(archiveUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  const buffer = await readResponseWithProgress(response, contentLength, progress);

  await progress?.onStep("Extracting...");

  if (archiveUrl.endsWith(".zip")) {
    await extractZip(buffer, destDir);
  } else {
    await extractTarGz(buffer, destDir);
  }

  await progress?.onStep("Ready!");
  return destDir;
}

async function readResponseWithProgress(
  response: Response,
  contentLength: number,
  progress?: InstallProgress,
): Promise<Buffer> {
  if (!response.body || contentLength === 0) {
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength > 0) {
      await progress?.onDownloadProgress(Math.round((received / contentLength) * 100));
    }
  }

  return Buffer.concat(chunks);
}

function validateExtractedPaths(destDir: string): void {
  const realDest = fs.realpathSync(destDir);
  const entries = fs.readdirSync(destDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const parentPath = (entry as unknown as { parentPath?: string; path?: string }).parentPath ?? (entry as unknown as { path: string }).path;
    const fullPath = path.join(parentPath, entry.name);
    let realPath: string;
    try {
      realPath = fs.realpathSync(fullPath);
    } catch {
      // Broken symlink — check where it points
      const linkTarget = fs.readlinkSync(fullPath);
      realPath = path.resolve(path.dirname(fullPath), linkTarget);
    }
    if (!realPath.startsWith(realDest + path.sep) && realPath !== realDest) {
      fs.rmSync(destDir, { recursive: true, force: true });
      throw new Error(`Archive contains unsafe path: ${entry.name}`);
    }
  }
}

async function extractTarGz(buffer: Buffer, destDir: string): Promise<void> {
  const { execFileSync } = await import("node:child_process");
  const tmpFile = path.join(destDir, "_archive.tar.gz");
  fs.writeFileSync(tmpFile, buffer);
  try {
    execFileSync("tar", ["xzf", tmpFile, "-C", destDir], { stdio: "pipe" });
  } finally {
    fs.unlinkSync(tmpFile);
  }
  validateExtractedPaths(destDir);
}

async function extractZip(buffer: Buffer, destDir: string): Promise<void> {
  const { execFileSync } = await import("node:child_process");
  const tmpFile = path.join(destDir, "_archive.zip");
  fs.writeFileSync(tmpFile, buffer);
  try {
    execFileSync("unzip", ["-o", tmpFile, "-d", destDir], { stdio: "pipe" });
  } finally {
    fs.unlinkSync(tmpFile);
  }
  validateExtractedPaths(destDir);
}

export async function uninstallAgent(
  agentKey: string,
  store: AgentStore,
): Promise<void> {
  const agent = store.getAgent(agentKey);
  if (!agent) return;

  if (agent.binaryPath && fs.existsSync(agent.binaryPath)) {
    fs.rmSync(agent.binaryPath, { recursive: true, force: true });
    log.info({ agentKey, binaryPath: agent.binaryPath }, "Deleted agent binary");
  }

  store.removeAgent(agentKey);
}
