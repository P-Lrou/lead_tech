// Integration test for the bearer-protected /mcp endpoint. The real MCP server
// and Streamable HTTP transport are exercised (nothing mocked); only a bare
// Express app is wired so there is no port binding.
process.env.MCP_API_KEY = 'test-key';

const express = require('express');
const request = require('supertest');
const mountMcpEndpoint = require('../../app/mcp_endpoint');

const app = express();
mountMcpEndpoint(app);

const AUTH = 'Bearer test-key';
const ACCEPT = 'application/json, text/event-stream';

function rpc(method, params, id) {
  return { jsonrpc: '2.0', id: id === undefined ? 1 : id, method, params: params || {} };
}

describe('POST /mcp - authorization', () => {
  test('401 when the Authorization header is missing', () => {
    return request(app)
      .post('/mcp')
      .set('Accept', ACCEPT)
      .send(rpc('initialize'))
      .expect(401)
      .expect('WWW-Authenticate', 'Bearer')
      .then(res => {
        expect(res.body.error.message).toBe('Unauthorized');
      });
  });

  test('401 when the bearer token does not match', () => {
    return request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer wrong')
      .set('Accept', ACCEPT)
      .send(rpc('initialize'))
      .expect(401);
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

  test('tools/list exposes the "ping" tool', () => {
    return request(app)
      .post('/mcp')
      .set('Authorization', AUTH)
      .set('Accept', ACCEPT)
      .send(rpc('tools/list', {}, 2))
      .expect(200)
      .then(res => {
        const names = res.body.result.tools.map(t => t.name);
        expect(names).toContain('ping');
      });
  });

  test('tools/call runs "ping" and echoes the message', () => {
    return request(app)
      .post('/mcp')
      .set('Authorization', AUTH)
      .set('Accept', ACCEPT)
      .send(rpc('tools/call', { name: 'ping', arguments: { message: 'hi' } }, 3))
      .expect(200)
      .then(res => {
        expect(res.body.result.content[0].text).toBe('pong: hi');
      });
  });
});
