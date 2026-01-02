import { consola, type ConsolaInstance } from "consola";

// Configure consola with pretty formatting
const logger: ConsolaInstance = consola.create({
  level: process.env.LOG_LEVEL === "debug" ? 4 : 3,
  formatOptions: {
    date: false,
    colors: true,
    compact: false,
  },
});

export const log = {
  info: (message: string, ...args: unknown[]) => logger.info(message, ...args),
  success: (message: string, ...args: unknown[]) => logger.success(message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn(message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error(message, ...args),
  debug: (message: string, ...args: unknown[]) => logger.debug(message, ...args),
  box: (message: string) => logger.box(message),
  start: (message: string) => logger.start(message),
  ready: (message: string) => logger.ready(message),

  // Progress-style logging (overwrites current line)
  progress: (message: string) => {
    process.stdout.write(`\r${message}`);
  },

  // End progress line
  progressEnd: () => {
    process.stdout.write("\n");
  },
};

export type Logger = typeof log;
