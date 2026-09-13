---
description: Run every quality gate CI runs, in one command, and report what failed.
---

Run:

```
bun run check
```

That is `lint:check`, `format:check`, `typecheck` and `bun test`, in that order,
stopping at the first failure. The **check** variants are deliberate: `bun run
lint` and `bun run format` fix in place, which would let a violation pass here
and fail in CI.

The end-to-end suite is separate because it spawns a server:

```
bun run test:e2e
```

For each gate:

- If it **passes**, note it and continue.
- If it **fails**, show the relevant output, then stop and say what needs
  fixing. Do not auto-fix unless asked.

Finish with a one-line summary: `✓ lint  ✓ format  ✓ typecheck  ✓ test`, marking
any failure with `✗`.
