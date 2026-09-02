// End-to-end test of the token bucket rate limiter on POST /zip.
//
// It mounts the real route table on a bare Express app (no server.js, so no
// port binding and no Pub/Sub consumer) and only stubs the collaborators that
// GET / and POST /zip would otherwise reach (network / cloud clients).
const express = require('express');
const request = require('supertest');

// Exercise the in-memory backend of the store, not Redis.
delete process.env.REDIS_HOST;

jest.mock('../app/queue_producer', () => ({
  publishZipRequest: jest.fn(() => Promise.resolve('mock-message-id'))
}));

// route.js also wires GET /, which pulls in photo_model (got, ESM-only under
// jest) and zip_job (GCS client). Neither is exercised here, so stub them.
jest.mock('../app/photo_model');
jest.mock('../app/zip_job', () => ({
  processZipRequest: jest.fn(),
  getSignedUrl: jest.fn(() => Promise.resolve('https://signed.example/a.zip')),
  completedJobs: {}
}));

const route = require('../app/route');
const queueProducer = require('../app/queue_producer');
const rateLimiter = require('../app/rate_limiter');
const rateLimitStore = require('../app/rate_limit_store');

const BUCKET_SIZE = rateLimiter.BUCKET_SIZE;
const REQUEST_COST = rateLimiter.REQUEST_COST;
const REFILL_RATE = rateLimiter.REFILL_RATE;

// with b=15, cost=3 -> 5 requests fit in a fresh bucket
const ALLOWED_BURST = Math.floor(BUCKET_SIZE / REQUEST_COST);
// seconds needed to earn one request's worth of tokens back
const REFILL_SECONDS = REQUEST_COST / REFILL_RATE;

const app = express();
route(app);

// Fire one POST /zip as if it came from `ip` (the limiter reads x-forwarded-for).
function zip(ip) {
  return request(app)
    .post('/zip?tags=cat')
    .set('X-Forwarded-For', ip);
}

// Fire `n` requests from `ip` one after another, resolving with the status codes.
function burst(ip, n) {
  let chain = Promise.resolve([]);
  for (let i = 0; i < n; i++) {
    chain = chain.then(codes => zip(ip).then(res => codes.concat(res.status)));
  }
  return chain;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('POST /zip rate limiting (token bucket)', () => {
  beforeEach(() => {
    rateLimitStore._memoryReset();
    queueProducer.publishZipRequest.mockClear();
  });

  test('allows an initial burst of floor(b / cost) requests', () => {
    return burst('10.0.0.1', ALLOWED_BURST).then(codes => {
      expect(codes).toEqual(new Array(ALLOWED_BURST).fill(303));
      expect(queueProducer.publishZipRequest).toHaveBeenCalledTimes(
        ALLOWED_BURST
      );
    });
  });

  test('drops further requests with 429 + Retry-After once the bucket is empty', () => {
    return burst('10.0.0.2', ALLOWED_BURST)
      .then(() => {
        queueProducer.publishZipRequest.mockClear();
        return zip('10.0.0.2');
      })
      .then(res => {
        expect(res.status).toBe(429);
        expect(res.headers['retry-after']).toBe(String(Math.ceil(REFILL_SECONDS)));
        expect(res.body).toEqual({ error: 'too many requests, slow down' });
        // a dropped request must not reach the queue
        expect(queueProducer.publishZipRequest).not.toHaveBeenCalled();
      });
  });

  test('buckets are per-IP: one blocked IP does not affect another', () => {
    return burst('10.0.0.3', ALLOWED_BURST + 2)
      .then(() => zip('10.0.0.3'))
      .then(res => expect(res.status).toBe(429))
      .then(() => zip('10.0.0.4'))
      .then(res => expect(res.status).toBe(303));
  });

  test('the missing-tags 400 is returned before the rate-limit check', () => {
    return burst('10.0.0.5', ALLOWED_BURST + 1)
      .then(() =>
        request(app)
          .post('/zip')
          .set('X-Forwarded-For', '10.0.0.5')
      )
      .then(res => expect(res.status).toBe(400));
  });

  test('the bucket refills over time', () => {
    return burst('10.0.0.6', ALLOWED_BURST)
      .then(() => zip('10.0.0.6'))
      .then(res => expect(res.status).toBe(429))
      // wait just over cost / r seconds -> exactly one request becomes available
      .then(() => wait(REFILL_SECONDS * 1000 + 400))
      .then(() => zip('10.0.0.6'))
      .then(res => expect(res.status).toBe(303))
      // and it is empty again immediately after
      .then(() => zip('10.0.0.6'))
      .then(res => expect(res.status).toBe(429));
  }, 15000);
});
