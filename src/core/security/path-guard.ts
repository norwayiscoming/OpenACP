import fs from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

const DEFAULT_DENY_PATTERNS = [
  ".env",
  ".env.*",
  "*.key",
  "*.pem",
  ".ssh/",
  ".aws/",
  ".openacp/",
  "**/credentials*",
  "**/secrets*",
  "**/*.secret",
];

export interface PathGuardOptions {
  cwd: string;
  allowedPaths: string[];
  ignorePatterns: string[];
}

export class PathGuard {
  private readonly cwd: string;
  private readonly allowedPaths: string[];
  private readonly ig: Ignore;

  constructor(options: PathGuardOptions) {
    // Use realpathSync to resolve symlinks (e.g., /var -> /private/var on macOS)
    try {
      this.cwd = fs.realpathSync(path.resolve(options.cwd));
    } catch {
      this.cwd = path.resolve(options.cwd);
    }
    this.allowedPaths = options.allowedPaths.map((p) => {
      try {
        return fs.realpathSync(path.resolve(p));
      } catch {
        return path.resolve(p);
      }
    });
    this.ig = ignore();
    this.ig.add(DEFAULT_DENY_PATTERNS);
    if (options.ignorePatterns.length > 0) {
      this.ig.add(options.ignorePatterns);
    }
  }

  validatePath(
    targetPath: string,
    operation: "read" | "write",
  ): { allowed: boolean; reason: string } {
    const resolved = path.resolve(targetPath);

    let realPath: string;
    try {
      realPath = fs.realpathSync(resolved);
    } catch {
      realPath = resolved;
    }

    if (operation === "write" && path.basename(realPath) === ".openacpignore") {
      return { allowed: false, reason: "Cannot write to .openacpignore" };
    }

    const isWithinCwd =
      realPath === this.cwd || realPath.startsWith(this.cwd + path.sep);
    const isWithinAllowed = this.allowedPaths.some(
      (ap) => realPath === ap || realPath.startsWith(ap + path.sep),
    );

    if (!isWithinCwd && !isWithinAllowed) {
      return {
        allowed: false,
        reason: `Path is outside workspace boundary: ${realPath}`,
      };
    }

    if (isWithinCwd) {
      const relativePath = path.relative(this.cwd, realPath);
      // Allow .openacpignore reads — it is a config file, not sensitive
      if (relativePath === ".openacpignore") {
        return { allowed: true, reason: "" };
      }
      if (relativePath && this.ig.ignores(relativePath)) {
        return {
          allowed: false,
          reason: `Path matches ignore pattern: ${relativePath}`,
        };
      }
    }

    return { allowed: true, reason: "" };
  }

  static loadIgnoreFile(cwd: string): string[] {
    const ignorePath = path.join(cwd, ".openacpignore");
    try {
      const content = fs.readFileSync(ignorePath, "utf-8");
      return content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
    } catch {
      return [];
    }
  }
}
