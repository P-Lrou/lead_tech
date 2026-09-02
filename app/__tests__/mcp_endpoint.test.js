// Integration test for the JWT-protected /mcp endpoint. The real MCP server and
// Streamable HTTP transport are exercised; only the collaborators the tools
// reach (Flickr, Firebase, Cloud Storage) are stubbed.
process.env.MCP_JWT_SECRET = 'test-secret';

const jwt = require('jsonwebtoken');

function mintToken(overrides) {
  const opts = Object.assign(
    { algorithm: 'HS256', audience: 'mcp-server', expiresIn: '5m' },
    overrides && overrides.options
  );
  return jwt.sign(
    (overrides && overrides.payload) || { scope: 'mcp' },
    (overrides && overrides.secret) || 'test-secret',
    opts
  );
}

jest.mock('../../app/photo_model', () => ({ getFlickrPhotos: jest.fn() }));
jest.mock('../../app/firebase_db', () => ({
  saveJob: jest.fn(() => Promise.resolve()),
  listJobs: jest.fn(() => Promise.resolve([]))
}));
jest.mock('../../app/zip_job', () => ({
  processZipRequest: jest.fn(),
  getSignedUrl: jest.fn(() => Promise.resolve('https://signed.example/a.zip')),
  completedJobs: {}
}));

const express = require('express');
const request = require('supertest');
const mountMcpEndpoint = require('../../app/mcp_endpoint');
const photoModel = require('../../app/photo_model');
const firebaseDb = require('../../app/firebase_db');
const zipJob = require('../../app/zip_job');

const app = express();
mountMcpEndpoint(app);

const AUTH = 'Bearer ' + mintToken();
const ACCEPT = 'application/json, text/event-stream';

function rpc(method, params, id) {
  return {
    jsonrpc: '2.0',
    id: id === undefined ? 1 : id,
    method,
    params: params || {}
  };
}

function callTool(name, args, id) {
  return request(app)
    .post('/mcp')
    .set('Authorization', AUTH)
    .set('Accept', ACCEPT)
    .send(rpc('tools/call', { name: name, arguments: args || {} }, id || 1))
    .expect(200)
    .then(res => res.body.result);
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('POST /mcp - authorization (JWT)', () => {
  function expect401(auth) {
    const req = request(app).post('/mcp').set('Accept', ACCEPT);
    if (auth !== undefined) {
      req.set('Authorization', auth);
    }
    return req
      .send(rpc('initialize'))
      .expect(401)
      .expect('WWW-Authenticate', /^Bearer/)
      .then(res => {
        expect(res.body.error.message).toBe('Unauthorized');
      });
  }

  test('401 when the Authorization header is missing', () => expect401());

  test('401 when the scheme is not Bearer', () =>
    expect401('Basic ' + Buffer.from('a:b').toString('base64')));

  test('401 when the token is not a JWT', () => expect401('Bearer not-a-jwt'));

  test('401 when the JWT is signed with the wrong secret', () =>
    expect401('Bearer ' + mintToken({ secret: 'other-secret' })));

  test('401 when the JWT is expired', () =>
    expect401('Bearer ' + mintToken({ options: { expiresIn: -10 } })));

  test('401 when the JWT has the wrong audience', () =>
    expect401('Bearer ' + mintToken({ options: { audience: 'someone-else' } })));

  test('200 with a valid JWT', () => {
    return request(app)
      .post('/mcp')
      .set('Authorization', AUTH)
      .set('Accept', ACCEPT)
      .send(
        rpc('initialize', {
          protocolVersion: '2026-07-28',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' }
        })
      )
      .expect(200);
  });
});

describe('POST /mcp - MCP server', () => {
  test('initialize returns the server info', () => {
    return request(app)
      .post('/mcp')
      .set('Authorization', AUTH)
      .set('Accept', ACCEPT)
      .send(
        rpc('initialize', {
          protocolVersion: '2026-07-28',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' }
        })
      )
      .expect(200)
      .then(res => {
        expect(res.body.result.serverInfo.name).toBe('lead-tech-mcp');
      });
  });

  test('tools/list exposes the four tools', () => {
    return request(app)
      .post('/mcp')
      .set('Authorization', AUTH)
      .set('Accept', ACCEPT)
      .send(rpc('tools/list', {}, 2))
      .expect(200)
      .then(res => {
        const names = res.body.result.tools.map(t => t.name).sort();
        expect(names).toEqual([
          'get-archive-download-url',
          'list-archives',
          'ping',
          'search-flickr-photos'
        ]);
      });
  });
});

describe('tool: search-flickr-photos', () => {
  test('returns the Flickr results for the given tags', () => {
    photoModel.getFlickrPhotos.mockResolvedValueOnce([
      {
        title: 'A cat',
        link: 'https://flickr/1',
        media: { b: 'https://img/1_b.jpg', t: 'https://img/1_t.jpg' },
        author: 'someone',
        published: '2026-01-01',
        tags: 'cat'
      }
    ]);

    return callTool('search-flickr-photos', { tags: 'cat' }).then(result => {
      expect(photoModel.getFlickrPhotos).toHaveBeenCalledWith('cat', 'all');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.count).toBe(1);
      expect(payload.photos[0]).toMatchObject({
        title: 'A cat',
        link: 'https://flickr/1',
        image: 'https://img/1_b.jpg'
      });
    });
  });

  test('passes the tagmode through', () => {
    photoModel.getFlickrPhotos.mockResolvedValueOnce([]);
    return callTool('search-flickr-photos', {
      tags: 'sunset,beach',
      tagmode: 'any'
    }).then(() => {
      expect(photoModel.getFlickrPhotos).toHaveBeenCalledWith(
        'sunset,beach',
        'any'
      );
    });
  });
});

describe('tool: list-archives', () => {
  test('lists the jobs stored in Firebase, newest first', () => {
    firebaseDb.listJobs.mockResolvedValueOnce([
      { tags: 'cat', storagePath: 'zips/b.zip', gsUri: 'gs://x/zips/b.zip', createdAt: 200 },
      { tags: 'dog', storagePath: 'zips/a.zip', gsUri: 'gs://x/zips/a.zip', createdAt: 100 }
    ]);

    return callTool('list-archives').then(result => {
      const payload = JSON.parse(result.content[0].text);
      expect(payload.count).toBe(2);
      expect(payload.archives.map(a => a.tags)).toEqual(['cat', 'dog']);
      expect(payload.archives[0].createdAtIso).toBe(
        new Date(200).toISOString()
      );
    });
  });
});

describe('tool: get-archive-download-url', () => {
  test('returns a fresh signed URL for a known archive', () => {
    firebaseDb.listJobs.mockResolvedValueOnce([
      { tags: 'cat', storagePath: 'zips/cat.zip', createdAt: 200 }
    ]);
    zipJob.getSignedUrl.mockResolvedValueOnce('https://signed.example/cat.zip');

    return callTool('get-archive-download-url', { tags: 'cat' }).then(result => {
      expect(zipJob.getSignedUrl).toHaveBeenCalledWith('zips/cat.zip');
      const payload = JSON.parse(result.content[0].text);
      expect(payload).toMatchObject({
        tags: 'cat',
        storagePath: 'zips/cat.zip',
        downloadUrl: 'https://signed.example/cat.zip'
      });
      expect(result.isError).toBeFalsy();
    });
  });

  test('flags an error when no archive matches the tags', () => {
    firebaseDb.listJobs.mockResolvedValueOnce([
      { tags: 'dog', storagePath: 'zips/dog.zip', createdAt: 200 }
    ]);

    return callTool('get-archive-download-url', { tags: 'cat' }).then(result => {
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/No archive found/);
      expect(zipJob.getSignedUrl).not.toHaveBeenCalled();
    });
  });
});
