/** How long a shutdown gets before the process ends itself anyway. */
export const FORCE_EXIT_MS = 8000;

/**
 * A shutdown watchdog, and a workaround for a measured defect rather than
 * general-purpose belt and braces.
 *
 * A process that **attempted a queue operation while Redis was unreachable** does
 * not exit on `SIGTERM`: bullmq holds a connection whose retry timer outlives
 * `close()`, and nothing in userland can cancel it. Measured here: with
 * `REDIS_URL` pointing at a closed port, `bun src/main.ts` was still alive 30
 * seconds after the signal.
 *
 * This app attempts one at boot - `AuthAdminSeeder` signs the first administrator
 * up, which fires the `user.registered` hook - so it is squarely in that case, and
 * an orchestrator's grace period would end in `SIGKILL` every time.
 *
 * Two halves, and both are needed:
 *
 *  - `cancel()`, called once `app.closed` has resolved, followed by an explicit
 *    `process.exit(0)`. Every shutdown hook has run by then, so leaving is correct,
 *    and it is what makes the healthy path exit immediately instead of waiting out
 *    the timer.
 *  - the timer itself, for a shutdown that never resolves at all.
 *
 * The timer is deliberately **not** `unref`'d. An unref'd one was tried first, on
 * the reasoning that the only case it needs to fire in is one where something else
 * already holds the loop open - it never fired.
 *
 * `console.warn` rather than the app `Logger`: by the time this fires the logger's
 * own transport may already be torn down, and a watchdog that throws is worse than
 * one that is unstructured.
 *
 * Remove this when `close()` clears the timer upstream.
 */
export const forceExitAfter = (ms: number = FORCE_EXIT_MS): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        console.warn(
          `[dunx-template] shutdown did not finish within ${ms}ms, exiting anyway. A connection that never opened is the usual reason.`,
        );
        process.exit(0);
      }, ms);
    });
  }

  return cancel;
};
