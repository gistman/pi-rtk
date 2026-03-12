import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export const DEFAULT_RTK_BINARY = "rtk";
export const FLAG_DISABLE = "pi-rtk-disable";
export const FLAG_BINARY = "pi-rtk-binary";
export const ENV_DISABLE = "PI_RTK_DISABLE";
export const ENV_BINARY = "PI_RTK_BINARY";

export interface PiRtkOptions {
  binaryPath?: string;
  disable?: boolean;
  onWarning?: (message: string, ctx: ExtensionContext | undefined) => void;
}

export interface ResolvedPiRtkOptions {
  binaryPath: string;
  disable: boolean;
}

export interface RtkRewriteResult {
  command: string;
  rewritten: boolean;
}

export interface RtkRuntimeState {
  availability?: boolean;
  availabilityCheck?: Promise<boolean>;
  warnedMissing: boolean;
}
