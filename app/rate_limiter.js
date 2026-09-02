// Token bucket rate limiter, keyed by client IP.
//
// Storage is a plain in-memory Map: there is no persistence, so every bucket is
// reset when the process restarts (good enough as a first step).
//
// The three tuning constants (see the assignment):
//   r    - tokens regained per second
//   b    - starting tokens = bucket size = maximum (allows an initial burst)
//   cost - tokens spent by one request

const REFILL_RATE = 1; // r
const BUCKET_SIZE = 15; // b
const REQUEST_COST = 3; // cost

// key: ip -> { tokens, updatedAt }
// updatedAt is the epoch (ms) of the last *refill*, not of the last request:
// while the bucket still has enough tokens we only decrement the count and leave
// the timestamp alone.
const buckets = new Map();

// Extract the caller's IP address (snippet from the assignment).
function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
}

// Try to spend REQUEST_COST tokens for `ip`.
// Returns true when the request is allowed (forward), false when it is dropped.
// `now` is injectable so tests can control the clock; it defaults to Date.now().
function consume(ip, now) {
  if (now === undefined) {
    now = Date.now();
  }

  const entry = buckets.get(ip);

  // First time we see this IP: start from a full bucket.
  if (!entry) {
    buckets.set(ip, { tokens: BUCKET_SIZE - REQUEST_COST, updatedAt: now });
    return true;
  }

  // Enough tokens: just decrement, keep the last-refill timestamp untouched.
  if (entry.tokens - REQUEST_COST >= 0) {
    entry.tokens -= REQUEST_COST;
    return true;
  }

  // Not enough tokens: try to refill with whatever accrued since the last refill.
  const elapsedSec = Math.floor((now - entry.updatedAt) / 1000);
  const refilled = Math.min(
    BUCKET_SIZE,
    entry.tokens + elapsedSec * REFILL_RATE
  );

  if (refilled - REQUEST_COST >= 0) {
    entry.tokens = refilled - REQUEST_COST;
    entry.updatedAt = now;
    return true;
  }

  // Still not enough after the refill: drop the request, store nothing.
  return false;
}

module.exports = {
  consume,
  getClientIp,
  REFILL_RATE,
  BUCKET_SIZE,
  REQUEST_COST,
  // exposed so tests can reset the state between cases
  buckets
};
