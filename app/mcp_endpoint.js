const express = require('express');
const jwt = require('jsonwebtoken');
const { NodeStreamableHTTPServerTransport } = require('@modelcontextprotocol/node');
const { createMcpServer } = require('./mcp_server');

// The /mcp endpoint expects a signed JWT (HS256) in the Authorization header:
//   Authorization: Bearer <jwt>
// Mint one with `npm run mcp:token` (see app/mcp_token.js). The token must be
// signed with MCP_JWT_SECRET and carry the "mcp-server" audience.
const MCP_JWT_SECRET = process.env.MCP_JWT_SECRET || 'dev-mcp-jwt-secret-change-me';
const MCP_JWT_AUDIENCE = 'mcp-server';

// Return the decoded claims for a valid bearer JWT, or null when the header is
// missing / malformed / the token fails verification (bad signature, expired,
// wrong audience, ...).
function verifyBearer(req) {
  const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!match) {
    return null;
  }
  try {
    return jwt.verify(match[1], MCP_JWT_SECRET, {
      algorithms: ['HS256'],
      audience: MCP_JWT_AUDIENCE
    });
  } catch (err) {
    return null;
  }
}

// One MCP server instance; a fresh transport is connected to it per request.
const server = createMcpServer();

function mountMcpEndpoint(app) {
  // express.json() is scoped to this route so the rest of the app is untouched.
  app.post('/mcp', express.json(), (req, res) => {
    // 1. Verify the bearer JWT.
    if (!verifyBearer(req)) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null
      });
    }

    // 2. Hand the request to the MCP server over a Streamable HTTP transport.
    // Stateless mode (no session id), plain JSON responses instead of an SSE
    // stream so the endpoint is easy to call with a simple HTTP client.
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on('close', () => {
      transport.close();
    });

    return server
      .connect(transport)
      .then(() => transport.handleRequest(req, res, req.body))
      .catch(error => {
        console.error('[mcp] request failed:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null
          });
        }
      });
  });
}

module.exports = mountMcpEndpoint;
module.exports.verifyBearer = verifyBearer;
