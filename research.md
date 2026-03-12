# Research Notes

This repo was implemented against the upstream states below on March 13, 2026.

- `pi-mono`: `4535415300f1599cd83807e1d1dd7f2615aabf70`
  Source: `https://github.com/badlogic/pi-mono`
- `rtk`: `188ec996b34806d0b5b72b527952c019d3766d8f`
  Source: `https://github.com/rtk-ai/rtk`

## Pi API Conclusions

### 1. `user_bash` is the right hook for `!` and `!!`

Current Pi interactive mode emits a `user_bash` event before it runs a user-entered shell command. The event result can either:

- return `operations` to customize execution while keeping Pi's normal UI/session path
- return a full `BashResult` to replace execution entirely

For this package, returning `operations` is the correct choice because it preserves Pi's existing bash UI and session recording path.

Relevant upstream files:

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/src/core/extensions/types.ts`
- `packages/coding-agent/src/core/extensions/runner.ts`

### 2. Overriding built-in `bash` does not require provider work

Pi's extension runtime merges registered extension tools into the session tool registry by tool name. A tool registered as `bash` overrides the built-in entry with the same name.

That makes provider registration the wrong abstraction here. RTK changes shell execution, not model transport.

Relevant upstream files:

- `packages/coding-agent/src/core/extensions/runner.ts`
- `packages/coding-agent/src/core/agent-session.ts`

### 3. Reusing `createBashTool()` is the safest way to preserve Pi UX

Pi exports `createBashTool()` and `BashOperations`. The built-in bash tool already handles:

- streaming partial output
- truncation details and temp-file behavior
- final non-zero exit conversion into Pi's normal error semantics

Reusing that tool with custom `BashOperations` preserves more behavior than re-implementing the tool contract manually.

Relevant upstream files:

- `packages/coding-agent/src/core/tools/bash.ts`
- `packages/coding-agent/src/index.ts`

### 4. Pi's built-in bash renderer still applies to an overridden `bash`

Pi's interactive tool renderer keeps using the built-in bash renderer when the tool name is `bash` and the override does not supply custom renderers. That is exactly what this package wants.

Relevant upstream file:

- `packages/coding-agent/src/modes/interactive/components/tool-execution.ts`

## RTK CLI Conclusions

### 1. `rtk rewrite` is the correct integration point

Current RTK exposes `rewrite` as the single source of truth for agent hook rewrites.

Documented behavior in source:

- exit `0` and print rewritten command when supported
- exit `1` with no output when unsupported

That matches this package's desired control flow exactly.

Relevant upstream files:

- `src/main.rs`
- `src/rewrite_cmd.rs`
- `INSTALL.md`

### 2. RTK positions `rewrite` as a thin-hook primitive

RTK's install and architecture docs describe the preferred agent integration as:

1. intercept command
2. call `rtk rewrite`
3. execute rewritten command when present

This package applies that same pattern directly inside Pi's extension/tool seams instead of using an external hook file.

Relevant upstream files:

- `INSTALL.md`
- `ARCHITECTURE.md`

## Design Decisions Driven by Research

- Tool-layer integration instead of provider-layer integration
- Override only `bash`, not Pi's other filesystem tools
- Reuse Pi's own bash tool implementation for rendering/truncation semantics
- Use `user_bash` returning `operations`, not a full custom result, to preserve Pi UX
- Keep RTK runtime coupling optional and degrade to passthrough when absent
- Share timeout budget across rewrite and execution so timeout semantics stay honest

## Known Uncertainties

- This package depends on Pi continuing to allow same-name tool overrides for built-ins.
- Tool execution callbacks do not expose a UI context the same way `user_bash` does, so missing-RTK warnings for model-called bash currently fall back to stderr instead of a guaranteed TUI notification.
- If Pi later exposes a first-class bash-operation override API for extensions, this package should prefer that seam over same-name tool replacement.
