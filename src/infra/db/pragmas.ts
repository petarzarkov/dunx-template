/**
 * The pragmas every connection to this database opens with, in one place
 * because there are four of them: the app, the migrate script, the seed script
 * and `create:admin`.
 *
 * `busy_timeout` is the one that is not obvious, and it is not optional here.
 * WAL lets many readers run beside one writer, but a **second writer** still
 * gets `SQLITE_BUSY` back immediately - it does not wait. This app is
 * genuinely multi-process: a web server, a worker, and a forked child per
 * `@JobHandler({ background: true })` job, all on one file. Without a timeout a
 * user creation racing a job handler's write is a 500 rather than a short wait,
 * which is exactly what the e2e suite started seeing once the media queue began
 * forking.
 *
 * Five seconds is long enough to cover a job handler's transaction and short
 * enough that a genuine deadlock still surfaces as a failure rather than a hang.
 */
export const SQLITE_PRAGMAS: readonly string[] = [
  'journal_mode = WAL',
  'busy_timeout = 5000',
  'foreign_keys = ON',
];
