// Storage backend for the token bucket rate limiter.
//
// Horizontal scaling problem: with N instances of the API, a per-process Map
// gives every instance its own bucket, so an abuser gets N times the allowance.
// When REDIS_HOST is configured the buckets live in a shared Redis instead, and
// the whole decision runs in one atomic Lua call so concurrent instances cannot
// race. Without REDIS_HOST we fall back to an in-memory Map (single instance,
// e.g. local dev or CI).
//
// Credentials come from the environment only (REDIS_PASSWORD is never hard-coded).

const bucket = require('./token_bucket');

const REDIS_HOST = process.env.REDIS_HOST;
const useRedis = Boolean(REDIS_HOST);

// ---------------------------------------------------------------------------
// In-memory backend (fallback)
// ---------------------------------------------------------------------------

const memory = new Map(); // key -> { tokens, updatedAt }

function memoryConsume(key, now) {
  const result = bucket.applyRequest(memory.get(key) || null, now);
  if (result.allowed) {
    memory.set(key, result.state);
  }
  return Promise.resolve({
    allowed: result.allowed,
    retryAfter: bucket.retryAfterSec()
  });
}

function memoryReset() {
  memory.clear();
}

// ---------------------------------------------------------------------------
// Redis backend
// ---------------------------------------------------------------------------

// Atomic token bucket, same steps as token_bucket.applyRequest().
//   KEYS[1] = bucket key
//   ARGV    = now(ms), r(tokens/s), b(max), cost, ttl(ms)
//   returns { allowed(0|1), tokens, retryAfter(s) }
const LUA = [
  "local key  = KEYS[1]",
  "local now  = tonumber(ARGV[1])",
  "local r    = tonumber(ARGV[2])",
  "local b    = tonumber(ARGV[3])",
  "local cost = tonumber(ARGV[4])",
  "local ttl  = tonumber(ARGV[5])",
  "",
  "local stored = redis.call('HMGET', key, 'tokens', 'updatedAt')",
  "local tokens = tonumber(stored[1])",
  "local updatedAt = tonumber(stored[2])",
  "",
  "local newTokens",
  "local newUpdatedAt",
  "",
  "if tokens == nil then",
  "  -- first hit: start from a full bucket",
  "  newTokens = b - cost",
  "  newUpdatedAt = now",
  "elseif tokens - cost >= 0 then",
  "  -- enough tokens: decrement, keep the last-refill timestamp",
  "  newTokens = tokens - cost",
  "  newUpdatedAt = updatedAt",
  "else",
  "  -- refill with whatever accrued since the last refill",
  "  local elapsed = math.floor((now - updatedAt) / 1000)",
  "  local refilled = math.min(b, tokens + elapsed * r)",
  "  if refilled - cost >= 0 then",
  "    newTokens = refilled - cost",
  "    newUpdatedAt = now",
  "  else",
  "    -- drop: leave tokens/updatedAt untouched, just keep the key alive",
  "    redis.call('PEXPIRE', key, ttl)",
  "    return { 0, math.floor(refilled), math.ceil((cost - refilled) / r) }",
  "  end",
  "end",
  "",
  "redis.call('HSET', key, 'tokens', newTokens, 'updatedAt', newUpdatedAt)",
  "redis.call('PEXPIRE', key, ttl)",
  "return { 1, newTokens, 0 }"
].join("\n");

let client = null;
let connectPromise = null;

function getClient() {
  if (!client) {
    const { createClient } = require('redis');
    client = createClient({
      username: process.env.REDIS_USERNAME || 'default',
      password: process.env.REDIS_PASSWORD,
      socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT) || 6379
      }
    });
    client.on('error', err => {
      console.error('[redis] client error:', err.message);
    });
  }
  return client;
}

function connect() {
  if (!useRedis) {
    return Promise.resolve(); // memory backend: nothing to connect
  }
  if (!connectPromise) {
    connectPromise = getClient()
      .connect()
      .then(() => {
        console.log(
          '[redis] connected - rate limiting is now shared across instances'
        );
      })
      .catch(err => {
        console.error('[redis] initial connection failed:', err.message);
        connectPromise = null; // let a later request retry the connection
        throw err;
      });
  }
  return connectPromise;
}

function redisConsume(key, now) {
  return connect()
    .then(() =>
      getClient().eval(LUA, {
        keys: ['rl:' + key],
        arguments: [
          String(now),
          String(bucket.REFILL_RATE),
          String(bucket.BUCKET_SIZE),
          String(bucket.REQUEST_COST),
          String(bucket.ttlMs())
        ]
      })
    )
    .then(reply => ({
      allowed: Number(reply[0]) === 1,
      retryAfter: Number(reply[2]) || bucket.retryAfterSec()
    }))
    .catch(err => {
      // Fail closed: if Redis is unreachable we reject the request rather than
      // let callers through unmetered.
      console.error(
        '[redis] rate-limit check failed, failing closed:',
        err.message
      );
      return {
        allowed: false,
        redisDown: true,
        retryAfter: bucket.retryAfterSec()
      };
    });
}

// ---------------------------------------------------------------------------

module.exports = {
  backend: useRedis ? 'redis' : 'memory',
  consume: useRedis ? redisConsume : memoryConsume,
  connect,
  // test helpers
  _memoryReset: memoryReset,
  _lua: LUA
};
