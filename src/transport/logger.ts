/** Small logger interface. Injected, never imported from a global. */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string): void;
}

/** Default logger: silent. The transport never prints on its own. */
export const nullLogger: Logger = {
  log(): void {
    // intentionally empty
  },
};

/** A logger that forwards to another sink, useful in tests. */
export function createLogger(sink: (level: LogLevel, message: string) => void): Logger {
  return {
    log(level: LogLevel, message: string): void {
      sink(level, message);
    },
  };
}
