# pi-rtk

`pi-rtk` is a standalone Pi extension package that routes Pi's `bash` tool and interactive `user_bash` flow through RTK's rewrite engine when possible, then falls back to Pi's normal shell execution when RTK does not apply.

## Why This Exists

This package deliberately lives at the tool layer instead of the provider layer.

- RTK changes shell command selection and output shape, not model transport.
- Pi already exposes the right seams for this: a built-in `bash` tool override and the `user_bash` extension event.
- Keeping this out of `pi-mono` core avoids coupling Pi itself to an optional RTK runtime.

## Scope

v1 only touches:

- model-called `bash`
- user-entered `!` and `!!` flows via `user_bash`

It does not replace Pi's `read`, `grep`, `find`, or `ls` tools.

## Architecture

`pi-rtk` uses the same strategy for both bash entry points:

1. Try `rtk rewrite <raw command>` in the same `cwd` and `env`.
2. If RTK exits `0` and prints a non-empty command, execute that rewritten command.
3. Otherwise run the original command unchanged.

Key helpers:

- `createRtkBashOps()`
- `tryRewriteWithRtk()`
- `runShell()`
- `checkRtkAvailable()`

The tool override is implemented by registering a `bash` tool with the same name as Pi's built-in tool and reusing Pi's exported `createBashTool()`. That preserves Pi's built-in bash UI behavior, output truncation, and non-zero exit handling instead of re-implementing them.

## Install

### As a Pi package

```bash
pi install /absolute/path/to/pi-rtk
```

Or publish and install through npm:

```bash
pi install npm:pi-rtk
```

`package.json` includes:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

so Pi can discover the extension automatically.

### Local development

```bash
npm install
pi -e ./src/index.ts
```

Build output is still produced in `dist/` for standard package exports:

```bash
npm run build
```

## Runtime Flags

The extension registers two Pi CLI flags:

- `--pi-rtk-disable`
  Disables the extension and leaves Pi's normal bash execution path intact.
- `--pi-rtk-binary <path>`
  Uses a specific RTK binary instead of resolving `rtk` from `PATH`.

Environment variable fallbacks:

- `PI_RTK_DISABLE=1`
- `PI_RTK_BINARY=/path/to/rtk`

## Behavior

- If `rtk` is available and can rewrite a command, Pi executes the rewritten command.
- If `rtk` returns exit `1`, empty stdout, or another non-fatal rewrite failure, Pi transparently passes through to the original command.
- If `rtk` is missing, the extension falls back to normal Pi bash execution and emits a one-time warning.
- Abort and timeout apply across both phases: RTK rewrite plus shell execution share one timeout budget.
- `!!` still stays excluded from LLM context because `user_bash` returns `operations` and lets Pi's normal session recording path handle the result.

## Limitations

- This package assumes current Pi internals where registering a tool named `bash` overrides the built-in tool in the session registry.
- The tool override is intentionally limited to bash and `user_bash`; RTK support for other Pi tools is out of scope here.
- Missing-RTK warning delivery depends on the execution path: user `!` flows use Pi UI notifications, model-called `bash` falls back to stderr because tool execution does not get a UI context in the exported tool wrapper.
- The package tracks the current Pi extension API shape validated in `research.md`. If upstream APIs move, the exported seams here should be the only places that need adjustment.

## Tests

Automated coverage is intentionally lightweight and focused on decision logic:

- rewrite success
- rewrite miss passthrough
- missing RTK detection and one-time warning
- stdout/stderr streaming
- abort propagation
- timeout budget sharing between rewrite and execution

Run:

```bash
npm run typecheck
npm test
npm run build
```

## Manual Verification

Use a Pi checkout with this package loaded.

1. RTK available, rewrite hit
   Run a command RTK rewrites, such as `git status`, through both model-called `bash` and interactive `!git status`.
   Expected: RTK-form command executes, bash UI still streams normally.
2. RTK available, rewrite miss
   Run a command RTK does not rewrite, such as `htop` or another local example.
   Expected: original command executes unchanged.
3. RTK missing
   Launch Pi with `--pi-rtk-binary /tmp/does-not-exist`.
   Expected: one warning, then normal Pi bash behavior.
4. Non-zero exit
   Run `false`.
   Expected: Pi preserves the non-zero exit semantics it normally shows for `bash`.
5. Abort
   Run `sleep 30`, then cancel.
   Expected: command aborts and Pi shows the normal aborted state.
6. Timeout
   Run a long command with bash timeout set.
   Expected: timeout still fires even if RTK rewrite ran first.

## Example Entrypoint

`pi-rtk` also ships an example entrypoint at `pi-rtk/example` for projects that want an explicit wrapper module:

```ts
import extension from "pi-rtk/example";

export default extension;
```

## Acceptance Criteria

- Optional package, no `pi-mono` core changes
- No provider registration or provider override
- Only `bash` and `user_bash` are intercepted
- Rewrite-first, passthrough-second command flow
- Preserved Pi bash rendering and truncation behavior
- Preserved stdout/stderr streaming
- Preserved non-zero exit semantics
- Abort and timeout propagation
- Graceful no-RTK fallback with one-time warning
