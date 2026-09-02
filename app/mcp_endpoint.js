const express = require('express');
const { McpServer } = require('@modelcontextprotocol/server');
const { NodeStreamableHTTPServerTransport } = require('@modelcontextprotocol/node');
const { z } = require('zod');

// The /mcp endpoint expects this exact value in the "Authorization" header:
//   Authorization: Bearer MY_HARDCODED_API_KEY
const MCP_API_KEY = process.env.MCP_API_KEY || 'MY_HARDCODED_API_KEY';
const EXPECTED_AUTHORIZATION = 'Bearer ' + MCP_API_KEY;

// One MCP server instance, wired up once with the tools/resources it exposes.
// (Same shape as the SDK example: the server is created outside the handler and
// a fresh transport is connected to it per request.)
const server = new McpServer({ name: 'lead-tech-mcp', version: '1.0.0' });

// A minimal demo tool so the server has something callable.
server.registerTool(
  'ping',
  {
    title: 'Ping',
    description: 'Replies "pong", optionally echoing a message back.',
    inputSchema: z.object({ message: z.string().optional() })
  },
  args => {
    const suffix = args && args.message ? ': ' + args.message : '';
    return { content: [{ type: 'text', text: 'pong' + suffix }] };
  }
);

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
