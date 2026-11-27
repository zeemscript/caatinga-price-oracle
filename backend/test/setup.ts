// Each Vitest worker process runs concurrently against a FIXED env.SQLITE_PATH
// would mean every worker's better-sqlite3 handle fights over the same file
// on disk (observed as flaky "unable to open database file" / corrupted-row
// failures only when the full suite ran, never in a single file). Giving each
// worker process its own unique path removes the contention entirely; this
// must run before any test file imports src/lib/db.ts.
process.env.SQLITE_PATH = `./.tmp-test/oracle-test-${process.pid}-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2)}.db`;
