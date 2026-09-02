const express = require('express');
const { NodeStreamableHTTPServerTransport } = require('@modelcontextprotocol/node');
const { createMcpServer } = require('./mcp_server');

// The /mcp endpoint expects this exact value in the "Authorization" header:
//   Authorization: Bearer MY_HARDCODED_API_KEY
const MCP_API_KEY = process.env.MCP_API_KEY || 'MY_HARDCODED_API_KEY';
const EXPECTED_AUTHORIZATION = 'Bearer ' + MCP_API_KEY;

// One MCP server instance; a fresh transport is connected to it per request.
const server = createMcpServer();

function mountMcpEndpoint(app) {
  // express.json() is scoped to this route so the rest of the app is untouched.
  app.post('/mcp', express.json(), (req, res) => {
    // 1. Bearer check on the "Authorization" header.
    if (req.get('authorization') !== EXPECTED_AUTHORIZATION) {
      res.set('WWW-Authenticate', 'Bearer');
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
