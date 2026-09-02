const rateLimiter = require('../../app/rate_limiter');

const { BUCKET_SIZE, REQUEST_COST } = rateLimiter;

describe('getClientIp(req)', () => {
  test('prefers the x-forwarded-for header', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.7' },
      socket: { remoteAddress: '10.0.0.1' }
    };
    expect(rateLimiter.getClientIp(req)).toBe('203.0.113.7');
  });

  test('falls back to the socket remote address', () => {
    const req = { headers: {}, socket: { remoteAddress: '10.0.0.1' } };
    expect(rateLimiter.getClientIp(req)).toBe('10.0.0.1');
  });

  test('returns null when nothing identifies the caller', () => {
    const req = { headers: {}, socket: {} };
    expect(rateLimiter.getClientIp(req)).toBeNull();
  });
});

describe('consume(ip, now) - token bucket (r=1, b=15, cost=3)', () => {
  beforeEach(() => {
    rateLimiter.buckets.clear();
  });

  test('defaults the clock to Date.now() when no timestamp is passed', () => {
    const before = Date.now();
    expect(rateLimiter.consume('now.default')).toBe(true);
    const entry = rateLimiter.buckets.get('now.default');
    expect(entry.tokens).toBe(BUCKET_SIZE - REQUEST_COST);
    expect(entry.updatedAt).toBeGreaterThanOrEqual(before);
  });

  test('a brand new IP is allowed and seeded with b - cost tokens', () => {
    expect(rateLimiter.consume('1.1.1.1', 0)).toBe(true);
    expect(rateLimiter.buckets.get('1.1.1.1')).toEqual({
      tokens: BUCKET_SIZE - REQUEST_COST,
      updatedAt: 0
    });
  });

  test('allows floor(b / cost) requests in a burst, then drops', () => {
    const now = 1000;
    // 15 -> 12 -> 9 -> 6 -> 3 -> 0
    for (let i = 0; i < 5; i++) {
      expect(rateLimiter.consume('2.2.2.2', now)).toBe(true);
    }
    expect(rateLimiter.buckets.get('2.2.2.2').tokens).toBe(0);

    // no time has passed: refill adds nothing, request is dropped
    expect(rateLimiter.consume('2.2.2.2', now)).toBe(false);
    expect(rateLimiter.buckets.get('2.2.2.2')).toEqual({
      tokens: 0,
      updatedAt: now
    });
  });

  test('the normal decrement path leaves updatedAt untouched', () => {
    rateLimiter.consume('3.3.3.3', 5000);
    rateLimiter.consume('3.3.3.3', 9000);
    expect(rateLimiter.buckets.get('3.3.3.3')).toEqual({
      tokens: BUCKET_SIZE - 2 * REQUEST_COST,
      updatedAt: 5000
    });
  });

  test('an exhausted IP is allowed again once enough tokens have accrued', () => {
    const start = 10000;
    for (let i = 0; i < 5; i++) {
      rateLimiter.consume('4.4.4.4', start);
    }
    expect(rateLimiter.consume('4.4.4.4', start)).toBe(false);

    // 1 token/s: after 2s only 2 tokens < cost -> still dropped
    expect(rateLimiter.consume('4.4.4.4', start + 2000)).toBe(false);

    // after 3s, 3 tokens accrued -> allowed, and updatedAt moves to now
    expect(rateLimiter.consume('4.4.4.4', start + 3000)).toBe(true);
    expect(rateLimiter.buckets.get('4.4.4.4')).toEqual({
      tokens: 0,
      updatedAt: start + 3000
    });
  });

  test('refill is capped at the bucket size', () => {
    const start = 20000;
    for (let i = 0; i < 5; i++) {
      rateLimiter.consume('5.5.5.5', start);
    }
    rateLimiter.consume('5.5.5.5', start); // dropped, tokens stay at 0

    // a very long wait would accrue far more than b tokens; it must clamp to b
    expect(rateLimiter.consume('5.5.5.5', start + 1000 * 1000)).toBe(true);
    expect(rateLimiter.buckets.get('5.5.5.5').tokens).toBe(
      BUCKET_SIZE - REQUEST_COST
    );
  });
});
