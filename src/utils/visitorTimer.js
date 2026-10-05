export const DEFAULT_VISITOR_TIMEOUT_MINUTES = 3;
export const MIN_VISITOR_TIMEOUT_MINUTES = 1;
export const MAX_VISITOR_TIMEOUT_MINUTES = 30;
export const VISITOR_COUNTDOWN_SECONDS = 10;

const MILLISECONDS_PER_MINUTE = 60 * 1000;

export function normalizeVisitorTimeoutMinutes(
  value,
  fallback = DEFAULT_VISITOR_TIMEOUT_MINUTES,
) {
  return Number.isInteger(value) &&
    value >= MIN_VISITOR_TIMEOUT_MINUTES &&
    value <= MAX_VISITOR_TIMEOUT_MINUTES
    ? value
    : fallback;
}

export function createVisitorTimer({
  timeoutMinutes = DEFAULT_VISITOR_TIMEOUT_MINUTES,
  now = Date.now(),
} = {}) {
  const normalizedMinutes = normalizeVisitorTimeoutMinutes(timeoutMinutes);
  return {
    timeoutMinutes: normalizedMinutes,
    startedAt: now,
    expiresAt: now + normalizedMinutes * MILLISECONDS_PER_MINUTE,
  };
}

export function resetVisitorTimer(
  timer,
  { timeoutMinutes = timer?.timeoutMinutes, now = Date.now() } = {},
) {
  return createVisitorTimer({ timeoutMinutes, now });
}

export function getVisitorTimerSnapshot(timer, now = Date.now()) {
  if (!timer) {
    return {
      remainingMs: 0,
      remainingSeconds: 0,
      countdownSeconds: 0,
      isWarning: false,
      expired: false,
    };
  }

  const remainingMs = Math.max(0, timer.expiresAt - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const expired = remainingMs === 0;
  const isWarning =
    !expired && remainingSeconds <= VISITOR_COUNTDOWN_SECONDS;

  return {
    remainingMs,
    remainingSeconds,
    countdownSeconds: isWarning ? remainingSeconds : 0,
    isWarning,
    expired,
  };
}
