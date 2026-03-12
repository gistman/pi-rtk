import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type {
  BashOperations,
  ExtensionContext
} from "@mariozechner/pi-coding-agent";
import { getShellConfig } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_RTK_BINARY,
  type PiRtkOptions,
  type ResolvedPiRtkOptions,
  type RtkRewriteResult,
  type RtkRuntimeState
} from "./types.js";

interface SpawnBudgetOptions {
  signal?: AbortSignal;
  timeoutSeconds?: number;
  timeoutLabelSeconds?: number;
}

interface RewriteOptions extends SpawnBudgetOptions {
  binaryPath?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  state: RtkRuntimeState;
  onWarning?: (message: string, ctx: ExtensionContext | undefined) => void;
  warningContext?: ExtensionContext;
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        detached: true,
        stdio: "ignore"
      });
    } catch {
      // Ignore cleanup failures.
    }
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
}

function emitWarningOnce(
  state: RtkRuntimeState,
  message: string,
  onWarning: RewriteOptions["onWarning"],
  ctx: ExtensionContext | undefined
): void {
  if (state.warnedMissing) {
    return;
  }

  state.warnedMissing = true;
  onWarning?.(message, ctx);
}

function getRemainingTimeoutSeconds(timeoutSeconds: number | undefined, startedAt: number): number | undefined {
  if (timeoutSeconds === undefined || timeoutSeconds <= 0) {
    return undefined;
  }

  const remainingMs = timeoutSeconds * 1000 - (Date.now() - startedAt);
  return Math.max(remainingMs / 1000, 0);
}

function createTimeoutError(timeoutLabelSeconds: number | undefined, fallbackTimeoutSeconds: number | undefined): Error {
  return new Error(`timeout:${timeoutLabelSeconds ?? fallbackTimeoutSeconds ?? 0}`);
}

async function spawnForRewrite(
  binaryPath: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeoutSeconds?: number;
    timeoutLabelSeconds?: number;
  }
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }

    const child = spawn(binaryPath, args, {
      cwd: options.cwd,
      detached: true,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutHandle =
      options.timeoutSeconds !== undefined && options.timeoutSeconds > 0
        ? setTimeout(() => {
            timedOut = true;
            if (child.pid) {
              killProcessTree(child.pid);
            }
          }, options.timeoutSeconds * 1000)
        : undefined;

    const onAbort = () => {
      if (child.pid) {
        killProcessTree(child.pid);
      }
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.on("close", (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      options.signal?.removeEventListener("abort", onAbort);

      if (options.signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }

      if (timedOut) {
        reject(createTimeoutError(options.timeoutLabelSeconds, options.timeoutSeconds));
        return;
      }

      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

export async function runShell(
  command: string,
  cwd: string,
  options: {
    onData: (data: Buffer) => void;
    signal?: AbortSignal;
    timeout?: number;
    timeoutLabel?: number;
    env?: NodeJS.ProcessEnv;
  }
): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    if (!existsSync(cwd)) {
      reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
      return;
    }

    const { shell, args } = getShellConfig();
    const child = spawn(shell, [...args, command], {
      cwd,
      detached: true,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let timedOut = false;
    const timeoutHandle =
      options.timeout !== undefined && options.timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            if (child.pid) {
              killProcessTree(child.pid);
            }
          }, options.timeout * 1000)
        : undefined;

    const onAbort = () => {
      if (child.pid) {
        killProcessTree(child.pid);
      }
    };

    if (options.signal?.aborted) {
      onAbort();
    } else {
      options.signal?.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", options.onData);
    child.stderr?.on("data", options.onData);

    child.on("error", (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.on("close", (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      options.signal?.removeEventListener("abort", onAbort);

      if (options.signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }

      if (timedOut) {
        reject(createTimeoutError(options.timeoutLabel, options.timeout));
        return;
      }

      resolve({ exitCode: code });
    });
  });
}

export async function checkRtkAvailable(options: RewriteOptions): Promise<boolean> {
  if (options.state.availability !== undefined) {
    return options.state.availability;
  }

  if (options.state.availabilityCheck) {
    return options.state.availabilityCheck;
  }

  const binaryPath = options.binaryPath ?? DEFAULT_RTK_BINARY;
  const availabilityCheck = spawnForRewrite(binaryPath, ["--version"], {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    timeoutSeconds: options.timeoutSeconds,
    timeoutLabelSeconds: options.timeoutLabelSeconds
  })
    .then((result) => result.exitCode === 0)
    .catch((error: unknown) => {
      if (error instanceof Error && (error.message === "aborted" || error.message.startsWith("timeout:"))) {
        throw error;
      }

      return false;
    })
    .then((available) => {
      options.state.availability = available;
      options.state.availabilityCheck = undefined;
      if (!available) {
        emitWarningOnce(
          options.state,
          `[pi-rtk] RTK binary "${binaryPath}" not found. Falling back to Pi's normal bash execution.`,
          options.onWarning,
          options.warningContext
        );
      }
      return available;
    })
    .catch((error) => {
      options.state.availabilityCheck = undefined;
      throw error;
    });

  options.state.availabilityCheck = availabilityCheck;
  return availabilityCheck;
}

export async function tryRewriteWithRtk(
  rawCommand: string,
  options: RewriteOptions
): Promise<RtkRewriteResult> {
  const binaryPath = options.binaryPath ?? DEFAULT_RTK_BINARY;
  const available = await checkRtkAvailable({
    ...options,
    binaryPath
  });

  if (!available) {
    return { command: rawCommand, rewritten: false };
  }

  try {
    const result = await spawnForRewrite(binaryPath, ["rewrite", rawCommand], {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      timeoutSeconds: options.timeoutSeconds,
      timeoutLabelSeconds: options.timeoutLabelSeconds
    });

    const rewrittenCommand = result.stdout.trim();
    if (result.exitCode === 0 && rewrittenCommand.length > 0) {
      return {
        command: rewrittenCommand,
        rewritten: rewrittenCommand !== rawCommand
      };
    }

    return { command: rawCommand, rewritten: false };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "aborted" || error.message.startsWith("timeout:")) {
        throw error;
      }

      const spawnError = error as NodeJS.ErrnoException;
      if (spawnError.code === "ENOENT") {
        options.state.availability = false;
        emitWarningOnce(
          options.state,
          `[pi-rtk] RTK binary "${binaryPath}" not found. Falling back to Pi's normal bash execution.`,
          options.onWarning,
          options.warningContext
        );
      }
    }

    return { command: rawCommand, rewritten: false };
  }
}

export function createRtkBashOps(
  resolvedOptions: ResolvedPiRtkOptions,
  state: RtkRuntimeState,
  warningOptions?: Pick<RewriteOptions, "onWarning" | "warningContext">
): BashOperations {
  return {
    async exec(command, cwd, options) {
      if (resolvedOptions.disable) {
        return runShell(command, cwd, {
          onData: options.onData,
          signal: options.signal,
          timeout: options.timeout,
          timeoutLabel: options.timeout,
          env: options.env
        });
      }

      const startedAt = Date.now();
      const rewritten = await tryRewriteWithRtk(command, {
        binaryPath: resolvedOptions.binaryPath,
        cwd,
        env: options.env,
        signal: options.signal,
        timeoutSeconds: options.timeout,
        timeoutLabelSeconds: options.timeout,
        state,
        onWarning: warningOptions?.onWarning,
        warningContext: warningOptions?.warningContext
      });

      const remainingTimeout = getRemainingTimeoutSeconds(options.timeout, startedAt);
      if (remainingTimeout !== undefined && remainingTimeout <= 0) {
        throw createTimeoutError(options.timeout, options.timeout);
      }

      return runShell(rewritten.command, cwd, {
        onData: options.onData,
        signal: options.signal,
        timeout: remainingTimeout,
        timeoutLabel: options.timeout,
        env: options.env
      });
    }
  };
}

export function resolveOptions(
  baseOptions: PiRtkOptions | undefined,
  flagReader?: (flagName: string) => boolean | string | undefined
): ResolvedPiRtkOptions {
  const envDisable = process.env.PI_RTK_DISABLE === "1" || process.env.PI_RTK_DISABLE === "true";
  const envBinary = process.env.PI_RTK_BINARY;
  const flagDisable = flagReader?.("pi-rtk-disable");
  const flagBinary = flagReader?.("pi-rtk-binary");

  return {
    binaryPath:
      (typeof flagBinary === "string" && flagBinary.trim()) ||
      envBinary ||
      baseOptions?.binaryPath ||
      DEFAULT_RTK_BINARY,
    disable: Boolean(baseOptions?.disable || envDisable || flagDisable)
  };
}
