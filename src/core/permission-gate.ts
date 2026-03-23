import type { PermissionRequest } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Encapsulates pending permission state with a typed Promise API.
 */
export class PermissionGate {
  private request?: PermissionRequest;
  private resolveFn?: (optionId: string) => void;
  private rejectFn?: (reason: Error) => void;
  private settled = false;
  private timeoutTimer?: ReturnType<typeof setTimeout>;
  private timeoutMs: number;

  constructor(timeoutMs?: number) {
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  setPending(request: PermissionRequest): Promise<string> {
    this.request = request;
    this.settled = false;
    this.clearTimeout();

    return new Promise<string>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;

      this.timeoutTimer = setTimeout(() => {
        this.reject("Permission request timed out (no response received)");
      }, this.timeoutMs);
    });
  }

  resolve(optionId: string): void {
    if (this.settled || !this.resolveFn) return;
    this.settled = true;
    this.clearTimeout();
    this.resolveFn(optionId);
    this.cleanup();
  }

  reject(reason?: string): void {
    if (this.settled || !this.rejectFn) return;
    this.settled = true;
    this.clearTimeout();
    this.rejectFn(new Error(reason ?? "Permission rejected"));
    this.cleanup();
  }

  get isPending(): boolean {
    return !!this.request && !this.settled;
  }

  get currentRequest(): PermissionRequest | undefined {
    return this.isPending ? this.request : undefined;
  }

  /** The request ID of the current pending request, undefined after settlement */
  get requestId(): string | undefined {
    return this.request?.id;
  }

  private clearTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
  }

  private cleanup(): void {
    this.request = undefined;
    this.resolveFn = undefined;
    this.rejectFn = undefined;
  }
}
