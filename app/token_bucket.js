// Pure token bucket algorithm - no I/O, no clock of its own.
// This is the single source of truth for the rate-limiting maths; the Redis
// backend re-implements the exact same steps in Lua (see rate_limit_store.js)
// and app/__tests__ keeps the two in sync.
//
// The three tuning constants (see the assignment):
//   r    - tokens regained per second
//   b    - starting tokens = bucket size = maximum (allows an initial burst)
//   cost - tokens spent by one request

const REFILL_RATE = 1; // r
const BUCKET_SIZE = 15; // b
const REQUEST_COST = 3; // cost

// Given the stored bucket state and the current time, decide whether one
// request may spend REQUEST_COST tokens.
//
//   state : { tokens, updatedAt } or null/undefined when the caller is unknown
//           (updatedAt is the epoch in ms of the last *refill*, not the last
//            request)
//   now   : current epoch in ms
//
// Returns { allowed, state } where `state` is the value to persist. On a drop
// `state` is null: the caller must not write anything.
function applyRequest(state, now) {
  // First time we see this caller: start from a full bucket.
  if (!state) {
    return {
      allowed: true,
      state: { tokens: BUCKET_SIZE - REQUEST_COST, updatedAt: now }
    };
  }

  // Enough tokens: just decrement, keep the last-refill timestamp untouched.
  if (state.tokens - REQUEST_COST >= 0) {
    return {
      allowed: true,
      state: { tokens: state.tokens - REQUEST_COST, updatedAt: state.updatedAt }
    };
  }

  // Not enough tokens: try to refill with whatever accrued since the last refill.
  const elapsedSec = Math.floor((now - state.updatedAt) / 1000);
  const refilled = Math.min(
    BUCKET_SIZE,
    state.tokens + elapsedSec * REFILL_RATE
  );

  if (refilled - REQUEST_COST >= 0) {
    return {
      allowed: true,
      state: { tokens: refilled - REQUEST_COST, updatedAt: now }
    };
  }

  // Still not enough after the refill: drop the request, store nothing.
  return { allowed: false, state: null };
}

// Seconds a dropped caller should wait before retrying (best effort).
function retryAfterSec() {
  return Math.ceil(REQUEST_COST / REFILL_RATE);
}

// How long an idle bucket can be forgotten: after this it would be full again
// anyway, so dropping the key is equivalent to keeping it.
function ttlMs() {
  return Math.ceil(BUCKET_SIZE / REFILL_RATE) * 1000;
}

module.exports = {
  REFILL_RATE,
  BUCKET_SIZE,
  REQUEST_COST,
  applyRequest,
  retryAfterSec,
  ttlMs
};
