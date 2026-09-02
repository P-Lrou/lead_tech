// Mint a bearer JWT for the /mcp endpoint.
//
//   npm run mcp:token           -> token valid 1h
//   npm run mcp:token -- 30m    -> custom lifetime (any ms/vercel style string)
//
// The token is signed with MCP_JWT_SECRET (HS256) and carries the audience the
// endpoint checks. Keep MCP_JWT_SECRET in .env, never in the repo.
//
// quiet: keep stdout to just the token so the output can be piped / captured.
require('dotenv').config({ quiet: true });

const jwt = require('jsonwebtoken');

const secret = process.env.MCP_JWT_SECRET;
if (!secret) {
  console.error('MCP_JWT_SECRET is not set (add it to .env)');
  process.exit(1);
}

const expiresIn = process.argv[2] || '1h';

const token = jwt.sign({ scope: 'mcp' }, secret, {
  algorithm: 'HS256',
  audience: 'mcp-server',
  subject: 'mcp-client',
  expiresIn: expiresIn
});

console.log(token);
