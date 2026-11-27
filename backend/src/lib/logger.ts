type Level = "info" | "warn" | "error" | "debug";

function emit(level: Level, scope: string, message: string, extra?: unknown) {
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(extra !== undefined ? { extra: serializeExtra(extra) } : {}),
  };
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  out(JSON.stringify(line));
}

function serializeExtra(extra: unknown): unknown {
  if (extra instanceof Error) {
    return { name: extra.name, message: extra.message, code: (extra as { code?: string }).code };
  }
  return extra;
}

export function createLogger(scope: string) {
  return {
    info: (message: string, extra?: unknown) => emit("info", scope, message, extra),
    warn: (message: string, extra?: unknown) => emit("warn", scope, message, extra),
    error: (message: string, extra?: unknown) => emit("error", scope, message, extra),
    debug: (message: string, extra?: unknown) => emit("debug", scope, message, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
