const bucket = require('../../app/token_bucket');

const { BUCKET_SIZE, REQUEST_COST, applyRequest } = bucket;

// Drive a sequence of requests through applyRequest, threading the state.
function replay(steps) {
  let state = null;
  return steps.map(now => {
    const result = applyRequest(state, now);
    if (result.allowed) {
      state = result.state;
    }
    return { allowed: result.allowed, state };
  });
}

describe('applyRequest(state, now) - token bucket (r=1, b=15, cost=3)', () => {
  test('a fresh caller is allowed and seeded with b - cost tokens', () => {
    expect(applyRequest(null, 0)).toEqual({
      allowed: true,
      state: { tokens: BUCKET_SIZE - REQUEST_COST, updatedAt: 0 }
    });
  });

  test('allows floor(b / cost) requests in a burst, then drops', () => {
    const steps = replay([1000, 1000, 1000, 1000, 1000, 1000]);

    expect(steps.slice(0, 5).map(s => s.allowed)).toEqual([
      true,
      true,
      true,
      true,
      true
    ]);
    expect(steps[4].state).toEqual({ tokens: 0, updatedAt: 1000 });

    // 6th request: no time has passed, refill adds nothing -> dropped
    expect(steps[5].allowed).toBe(false);
    expect(steps[5].state).toEqual({ tokens: 0, updatedAt: 1000 });
  });

  test('the normal decrement path leaves updatedAt untouched', () => {
    const first = applyRequest(null, 5000);
    const second = applyRequest(first.state, 9000);
    expect(second.state).toEqual({
      tokens: BUCKET_SIZE - 2 * REQUEST_COST,
      updatedAt: 5000
    });
  });

  test('an exhausted bucket refills over time', () => {
    let state = null;
    for (let i = 0; i < 5; i++) {
      state = applyRequest(state, 10000).state;
    }
    expect(applyRequest(state, 10000).allowed).toBe(false);

    // 1 token/s: after 2s only 2 tokens < cost -> still dropped
    expect(applyRequest(state, 12000).allowed).toBe(false);

    // after 3s, 3 tokens accrued -> allowed, and updatedAt moves to now
    const refilled = applyRequest(state, 13000);
    expect(refilled.allowed).toBe(true);
    expect(refilled.state).toEqual({ tokens: 0, updatedAt: 13000 });
  });

  test('refill is capped at the bucket size', () => {
    let state = null;
    for (let i = 0; i < 5; i++) {
      state = applyRequest(state, 20000).state;
    }
    // a very long wait would accrue far more than b tokens; it must clamp to b
    const result = applyRequest(state, 20000 + 1000 * 1000);
    expect(result.allowed).toBe(true);
    expect(result.state.tokens).toBe(BUCKET_SIZE - REQUEST_COST);
  });

  test('a dropped request returns a null state (caller writes nothing)', () => {
    let state = null;
    for (let i = 0; i < 5; i++) {
      state = applyRequest(state, 0).state;
    }
    expect(applyRequest(state, 0)).toEqual({ allowed: false, state: null });
  });
});
