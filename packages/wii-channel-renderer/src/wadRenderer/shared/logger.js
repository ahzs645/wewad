export const NOOP_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  clear: () => {},
};

export function withLogger(logger) {
  return logger ?? NOOP_LOGGER;
}
