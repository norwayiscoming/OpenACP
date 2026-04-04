import * as clack from "@clack/prompts";
import { expandHome } from "../config/config.js";
import { guardCancel, ok, warn, dim, step } from "./helpers.js";

export async function setupRunMode(opts?: {
  existing?: { runMode: string; autoStart: boolean };
  stepNum?: number;
  totalSteps?: number;
  instanceRoot?: string;
}): Promise<{ runMode: 'foreground' | 'daemon'; autoStart: boolean }> {
  const { existing, stepNum, totalSteps } = opts ?? {};
  if (stepNum != null && totalSteps != null) {
    console.log(step(stepNum, totalSteps, 'Run Mode'));
  }

  // Don't show daemon option on Windows
  if (process.platform === 'win32') {
    console.log(dim('  (Daemon mode not available on Windows)'));
    return { runMode: 'foreground', autoStart: false };
  }

  const initialValue = (existing?.runMode === 'daemon' ? 'daemon' : 'foreground') as 'foreground' | 'daemon';

  const mode = guardCancel(
    await clack.select({
      message: 'How would you like to run OpenACP?',
      options: [
        {
          label: 'Background (daemon)',
          value: 'daemon' as const,
          hint: 'Runs silently, auto-starts on boot. Manage with: openacp status | stop | logs',
        },
        {
          label: 'Foreground (terminal)',
          value: 'foreground' as const,
          hint: 'Runs in current terminal session. Start with: openacp',
        },
      ],
      initialValue,
    }),
  );

  const wasDaemon = existing?.runMode === 'daemon';

  if (mode === 'daemon') {
    const { installAutoStart, isAutoStartSupported } = await import('../../cli/autostart.js');
    const { muteLogger, unmuteLogger } = await import('../utils/log.js');
    const autoStart = isAutoStartSupported();
    if (autoStart) {
      muteLogger();
      const logDir = opts?.instanceRoot ? `${opts.instanceRoot}/logs` : expandHome('~/.openacp/logs');
      const result = installAutoStart(logDir);
      unmuteLogger();
      if (result.success) {
        console.log(ok('Auto-start on boot enabled'));
      } else {
        console.log(warn(`Auto-start failed: ${result.error}`));
      }
    }
    return { runMode: 'daemon', autoStart };
  }

  // Switching from daemon → foreground: stop daemon + uninstall autostart
  if (wasDaemon) {
    const { muteLogger, unmuteLogger } = await import('../utils/log.js');
    muteLogger();
    try {
      const { stopDaemon } = await import('../../cli/daemon.js');
      const result = await stopDaemon();
      unmuteLogger();
      if (result.stopped) {
        console.log(ok(`Daemon stopped (was PID ${result.pid})`));
      }
    } catch {
      unmuteLogger();
      // Daemon may not be running
    }
    muteLogger();
    try {
      const { uninstallAutoStart } = await import('../../cli/autostart.js');
      uninstallAutoStart();
      unmuteLogger();
    } catch {
      unmuteLogger();
      // ignore
    }
  }

  return { runMode: 'foreground', autoStart: false };
}
