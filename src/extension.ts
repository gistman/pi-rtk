import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { createBashTool } from "@mariozechner/pi-coding-agent";
import {
  createRtkBashOps,
  resolveOptions
} from "./rtk.js";
import {
  FLAG_BINARY,
  FLAG_DISABLE,
  type PiRtkOptions,
  type RtkRuntimeState
} from "./types.js";

function defaultWarning(message: string, ctx: ExtensionContext | undefined): void {
  ctx?.ui.notify(message, "warning");
  if (!ctx) {
    console.error(message);
  }
}

export function createPiRtkExtension(baseOptions?: PiRtkOptions): ExtensionFactory {
  return function piRtkExtension(pi: ExtensionAPI): void {
    pi.registerFlag(FLAG_DISABLE, {
      description: "Disable pi-rtk and fall back to Pi's built-in bash behavior.",
      type: "boolean",
      default: false
    });

    pi.registerFlag(FLAG_BINARY, {
      description: "Path to the RTK binary to use for command rewrites.",
      type: "string"
    });

    const state: RtkRuntimeState = {
      warnedMissing: false
    };

    const getResolvedOptions = () =>
      resolveOptions(baseOptions, (flagName) => pi.getFlag(flagName));

    const getWarningHandler = (ctx?: ExtensionContext) => ({
      onWarning: baseOptions?.onWarning ?? defaultWarning,
      warningContext: ctx
    });

    pi.registerTool({
      ...createBashTool(process.cwd(), {
        operations: createRtkBashOps(getResolvedOptions(), state)
      }),
      async execute(toolCallId, params, signal, onUpdate) {
        const tool = createBashTool(process.cwd(), {
          operations: createRtkBashOps(getResolvedOptions(), state, getWarningHandler())
        });

        return tool.execute(toolCallId, params, signal, onUpdate);
      }
    });

    pi.on("user_bash", (event, ctx) => {
      return {
        operations: createRtkBashOps(getResolvedOptions(), state, getWarningHandler(ctx))
      };
    });
  };
}
