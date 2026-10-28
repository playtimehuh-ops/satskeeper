'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_RESET_DAYS = 7;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** 1.0 below 7 active days, 1.25 at 7+, 1.5 at 30+. */
function multiplierForStreak(streak) {
  const s = Number(streak) || 0;
  if (s >= 30) return 1.5;
  if (s >= 7) return 1.25;
  return 1.0;
}

/** True when the device has been idle for 7 or more days. */
function isIdle(lastActiveAt, now = new Date()) {
  if (!lastActiveAt) return false;
  return now.getTime() - new Date(lastActiveAt).getTime() >= IDLE_RESET_DAYS * DAY_MS;
}

function utcDay(date) {
  return Math.floor(new Date(date).getTime() / DAY_MS);
}

/**
 * Streak state after an activity heartbeat at `now`.
 * 7+ days idle resets streak and multiplier ONLY. Points are never part of this calculation.
 * Streak counts active UTC days; it increases once per new day.
 */
function applyStreak(device, now = new Date()) {
  const previous = Number(device.streak) || 0;

  if (!device.last_active_at) {
    return { streak: 1, multiplier: multiplierForStreak(1), reset: false };
  }
  if (isIdle(device.last_active_at, now)) {
    return { streak: 1, multiplier: 1.0, reset: true };
  }

  const newDay = utcDay(now) - utcDay(device.last_active_at) >= 1;
  const streak = newDay ? previous + 1 : Math.max(previous, 1);
  return { streak, multiplier: multiplierForStreak(streak), reset: false };
}

/** What to show/use right now for a device that may have gone idle since its last heartbeat. */
function effectiveState(device, now = new Date()) {
  if (isIdle(device.last_active_at, now)) {
    return { streak: 0, multiplier: 1.0, idle: true };
  }
  return {
    streak: Number(device.streak) || 0,
    multiplier: Number(device.multiplier) || 1.0,
    idle: false,
  };
}

/**
 * Points for a revenue amount: revenue * payout_pct * multiplier * points_per_cent.
 * The user share is capped at 100% of revenue so a multiplier can never pay out more than came in.
 */
function pointsForRevenue(revenueCents, cfg, multiplier = 1) {
  const share = Math.min(cfg.payout_pct * multiplier, 1);
  return round2(revenueCents * share * cfg.points_per_cent);
}

/** Points equivalent of an amount of cents (e.g. 100 cents -> 100 points at 100 points/dollar). */
function centsToPointsValue(cents, cfg) {
  return round2((cents * cfg.points_per_dollar) / 100);
}

/** Gift-card value in cents for an amount of points. */
function pointsToCents(points, cfg) {
  return Math.round((points / cfg.points_per_dollar) * 100);
}

module.exports = {
  IDLE_RESET_DAYS,
  round2,
  multiplierForStreak,
  isIdle,
  applyStreak,
  effectiveState,
  pointsForRevenue,
  centsToPointsValue,
  pointsToCents,
};
