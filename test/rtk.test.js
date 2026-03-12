import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRtkAvailable, createRtkBashOps, runShell, tryRewriteWithRtk } from "../src/rtk.js";
function createFakeRtk(scriptBody) {
    const dir = mkdtempSync(join(tmpdir(), "pi-rtk-test-"));
    const scriptPath = join(dir, "rtk");
    writeFileSync(scriptPath, `#!/usr/bin/env node
${scriptBody}
`, "utf8");
    chmodSync(scriptPath, 0o755);
    tempDirs.push(dir);
    return scriptPath;
}
const tempDirs = [];
afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            rmSync(dir, { force: true, recursive: true });
        }
    }
});
function createState() {
    return { warnedMissing: false };
}
describe("checkRtkAvailable", () => {
    it("returns false and warns once when RTK is missing", async () => {
        const warning = vi.fn();
        const state = createState();
        const available = await checkRtkAvailable({
            binaryPath: join(tmpdir(), "definitely-missing-pi-rtk"),
            cwd: process.cwd(),
            state,
            onWarning: warning
        });
        expect(available).toBe(false);
        expect(warning).toHaveBeenCalledTimes(1);
        const availableAgain = await checkRtkAvailable({
            binaryPath: join(tmpdir(), "definitely-missing-pi-rtk"),
            cwd: process.cwd(),
            state,
            onWarning: warning
        });
        expect(availableAgain).toBe(false);
        expect(warning).toHaveBeenCalledTimes(1);
    });
});
describe("tryRewriteWithRtk", () => {
    it("returns the rewritten command when RTK reports success", async () => {
        const binaryPath = createFakeRtk(`
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.exit(0);
}
if (args[0] === "rewrite") {
  if (args.slice(1).join(" ").includes("git status")) {
    process.stdout.write("rtk git status");
    process.exit(0);
  }
  process.exit(1);
}
process.exit(1);
`);
        const result = await tryRewriteWithRtk("git status", {
            binaryPath,
            cwd: process.cwd(),
            state: createState()
        });
        expect(result).toEqual({ command: "rtk git status", rewritten: true });
    });
    it("falls back to the raw command when RTK does not support a rewrite", async () => {
        const binaryPath = createFakeRtk(`
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.exit(0);
}
if (args[0] === "rewrite") {
  process.exit(1);
}
process.exit(1);
`);
        const result = await tryRewriteWithRtk("htop", {
            binaryPath,
            cwd: process.cwd(),
            state: createState()
        });
        expect(result).toEqual({ command: "htop", rewritten: false });
    });
});
describe("runShell", () => {
    it("streams stdout and stderr and preserves the exit code", async () => {
        const chunks = [];
        const result = await runShell("printf 'out'; printf 'err' >&2", process.cwd(), {
            onData: (data) => {
                chunks.push(data.toString("utf8"));
            }
        });
        expect(result.exitCode).toBe(0);
        expect(chunks.join("")).toContain("out");
        expect(chunks.join("")).toContain("err");
    });
});
describe("createRtkBashOps", () => {
    it("executes the rewritten command when RTK returns one", async () => {
        const binaryPath = createFakeRtk(`
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.exit(0);
}
if (args[0] === "rewrite") {
  process.stdout.write("printf rewritten");
  process.exit(0);
}
process.exit(1);
`);
        const ops = createRtkBashOps({ binaryPath, disable: false }, createState());
        const chunks = [];
        const result = await ops.exec("printf raw", process.cwd(), {
            onData: (data) => {
                chunks.push(data.toString("utf8"));
            }
        });
        expect(result.exitCode).toBe(0);
        expect(chunks.join("")).toBe("rewritten");
    });
    it("passes through to the raw command when disabled", async () => {
        const ops = createRtkBashOps({ binaryPath: "rtk", disable: true }, createState());
        const chunks = [];
        const result = await ops.exec("printf raw", process.cwd(), {
            onData: (data) => {
                chunks.push(data.toString("utf8"));
            }
        });
        expect(result.exitCode).toBe(0);
        expect(chunks.join("")).toBe("raw");
    });
    it("propagates aborts", async () => {
        const binaryPath = createFakeRtk(`
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.exit(0);
}
if (args[0] === "rewrite") {
  process.stdout.write("sleep 5");
  process.exit(0);
}
process.exit(1);
`);
        const controller = new AbortController();
        const ops = createRtkBashOps({ binaryPath, disable: false }, createState());
        const execution = ops.exec("sleep 5", process.cwd(), {
            onData: () => undefined,
            signal: controller.signal
        });
        setTimeout(() => controller.abort(), 100);
        await expect(execution).rejects.toThrow("aborted");
    });
    it("uses a shared timeout budget across rewrite and shell execution", async () => {
        const binaryPath = createFakeRtk(`
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.exit(0);
}
if (args[0] === "rewrite") {
  setTimeout(() => {
    process.stdout.write("sleep 1");
    process.exit(0);
  }, 150);
  return;
}
process.exit(1);
`);
        const ops = createRtkBashOps({ binaryPath, disable: false }, createState());
        await expect(ops.exec("sleep 1", process.cwd(), {
            onData: () => undefined,
            timeout: 0.2
        })).rejects.toThrow("timeout:0.2");
    });
});
//# sourceMappingURL=rtk.test.js.map