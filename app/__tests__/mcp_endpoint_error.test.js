// Covers the internal-error path of /mcp: when the MCP server / transport throws
// while handling a request, the endpoint answers a JSON-RPC 500 and does not
// leak the error.
process.env.MCP_JWT_SECRET = 'test-secret';

jest.mock('../../app/mcp_server', () => ({
  createMcpServer: () => ({
    connect: () => Promise.reject(new Error('connect blew up'))
  })
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mountMcpEndpoint = require('../../app/mcp_endpoint');

const app = express();
mountMcpEndpoint(app);

const AUTH =
  'Bearer ' +
  jwt.sign({ scope: 'mcp' }, 'test-secret', {
    algorithm: 'HS256',
    audience: 'mcp-server',
    expiresIn: '5m'
  });

test('answers a JSON-RPC 500 when request handling throws', () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  return request(app)
    .post('/mcp')
    .set('Authorization', AUTH)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    .expect(500)
    .then(res => {
      expect(res.body).toEqual({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
      expect(errSpy).toHaveBeenCalledWith(
        '[mcp] request failed:',
        expect.any(Error)
      );
      errSpy.mockRestore();
    });
});
