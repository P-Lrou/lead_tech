const request = require('supertest');

jest.mock('../../app/photo_model');

jest.mock('../../app/queue_producer', () => ({
  publishZipRequest: jest.fn(() => Promise.resolve('mock-message-id'))
}));

jest.mock('../../app/zip_job', () => ({
  processZipRequest: jest.fn(),
  getSignedUrl: jest.fn(() => Promise.resolve('https://signed.example/archive.zip')),
  completedJobs: {}
}));

jest.mock('../../app/firebase_db', () => ({ saveJob: jest.fn(() => Promise.resolve()) }));

jest.mock('../../app/rate_limiter', () => ({
  getClientIp: jest.fn(() => '1.2.3.4'),
  consume: jest.fn(() => true),
  REFILL_RATE: 1,
  REQUEST_COST: 3
}));

const app = require('../../app/server');
const queueProducer = require('../../app/queue_producer');
const zipJob = require('../../app/zip_job');
const rateLimiter = require('../../app/rate_limiter');

describe('index route', () => {
  afterEach(() => {
    app.server.close();
  });

  test('should respond with a 200 with no query parameters', () => {
    return request(app)
      .get('/')
      .expect('Content-Type', /html/)
      .expect(200)
      .then(response => {
        expect(response.text).toMatch(
          /<title>Express App Testing Demo<\/title>/
        );
      });
  });

  test('should respond with a 200 with valid query parameters', () => {
    return request(app)
      .get('/?tags=california&tagmode=all')
      .expect('Content-Type', /html/)
      .expect(200)
      .then(response => {
        expect(response.text).toMatch(
          /<div class="panel panel-default search-results">/
        );
      });
  });

  test('should respond with a 200 with invalid query parameters', () => {
    return request(app)
      .get('/?tags=california123&tagmode=all')
      .expect('Content-Type', /html/)
      .expect(200)
      .then(response => {
        expect(response.text).toMatch(/<div class="alert alert-danger">/);
      });
  });

  test('should respond with a 500 error due to bad jsonp data', () => {
    return request(app)
      .get('/?tags=error&tagmode=all')
      .expect('Content-Type', /json/)
      .expect(500)
      .then(response => {
        expect(response.body).toEqual({ error: 'Internal server error' });
      });
  });

  test('adds a signed download link when a zip already exists for the tags', () => {
    zipJob.completedJobs.california = 'zips/existing.zip';

    return request(app)
      .get('/?tags=california&tagmode=all')
      .expect(200)
      .then(response => {
        expect(zipJob.getSignedUrl).toHaveBeenCalledWith('zips/existing.zip');
        expect(response.text).toMatch(/https:\/\/signed\.example\/archive\.zip/);
        expect(response.text).toMatch(/Download zip/);
        delete zipJob.completedJobs.california;
      });
  });
});

describe('zip route', () => {
  afterEach(() => {
    app.server.close();
    jest.clearAllMocks();
  });

  test('rejects a request without the "tags" query parameter', () => {
    return request(app)
      .post('/zip')
      .expect(400)
      .then(response => {
        expect(response.body).toEqual({ error: 'missing "tags" query parameter' });
      });
  });

  test('publishes the tags and redirects back to the results page', () => {
    return request(app)
      .post('/zip?tags=sunset')
      .expect(303)
      .expect('Location', '/?tags=sunset&tagmode=all')
      .then(() => {
        expect(queueProducer.publishZipRequest).toHaveBeenCalledWith('sunset');
      });
  });

  test('responds with a 500 when publishing fails', () => {
    queueProducer.publishZipRequest.mockImplementationOnce(() =>
      Promise.reject(new Error('pubsub unavailable'))
    );

    return request(app)
      .post('/zip?tags=sunset')
      .expect(500)
      .then(response => {
        expect(response.body).toEqual({ error: 'pubsub unavailable' });
      });
  });

  test('responds with a 429 when the rate limiter drops the request', () => {
    rateLimiter.consume.mockImplementationOnce(() => false);

    return request(app)
      .post('/zip?tags=sunset')
      .expect(429)
      .expect('Retry-After', '3')
      .then(response => {
        expect(response.body).toEqual({ error: 'too many requests, slow down' });
        expect(queueProducer.publishZipRequest).not.toHaveBeenCalled();
      });
  });
});
