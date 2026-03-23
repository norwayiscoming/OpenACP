import type { Config } from "../config.js";

export interface DoctorContext {
  config: Config | null;
  rawConfig: unknown;
  configPath: string;
  dataDir: string;
  sessionsPath: string;
  pidPath: string;
  portFilePath: string;
  pluginsDir: string;
  logsDir: string;
}

export interface CheckResult {
  status: "pass" | "warn" | "fail";
  message: string;
  fixable?: boolean;
  fixRisk?: "safe" | "risky";
  fix?: () => Promise<FixResult>;
}

export interface FixResult {
  success: boolean;
  message: string;
}

export interface DoctorCheck {
  name: string;
  order: number;
  run(ctx: DoctorContext): Promise<CheckResult[]>;
}

export interface DoctorReport {
  categories: CategoryResult[];
  summary: { passed: number; warnings: number; failed: number; fixed: number };
  pendingFixes: PendingFix[];
}

export interface CategoryResult {
  name: string;
  results: CheckResult[];
}

export interface PendingFix {
  category: string;
  message: string;
  fix: () => Promise<FixResult>;
}
