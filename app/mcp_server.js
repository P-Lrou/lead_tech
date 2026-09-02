// The MCP server and the tools it exposes to an LLM. Kept separate from the
// HTTP/auth glue in mcp_endpoint.js.
//
// Tools:
//   ping                     - trivial health check
//   search-flickr-photos     - search the Flickr public feed by tags
//   list-archives            - list the zips already generated
//   get-archive-download-url - fresh signed download URL for a past zip
const { McpServer } = require('@modelcontextprotocol/server');
const { z } = require('zod');

const photoModel = require('./photo_model');
const zipJob = require('./zip_job');
const firebaseDb = require('./firebase_db');

// Every tool here answers with a single JSON text block.
function jsonResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function textResult(text, isError) {
  return { content: [{ type: 'text', text: text }], isError: Boolean(isError) };
}

function registerTools(server) {
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

  server.registerTool(
    'search-flickr-photos',
    {
      title: 'Search Flickr photos',
      description:
        'Search the Flickr public photo feed by tags. Returns the matching ' +
        'photos with their title, page link and image URLs.',
      inputSchema: z.object({
        tags: z
          .string()
          .min(1)
          .describe('Comma-separated tags, e.g. "sunset,beach"'),
        tagmode: z
          .enum(['all', 'any'])
          .optional()
          .describe('Match "all" the tags or "any" of them (default "all")')
      })
    },
    args => {
      const tagmode = args.tagmode || 'all';
      return photoModel.getFlickrPhotos(args.tags, tagmode).then(photos => {
        const results = photos.map(photo => ({
          title: photo.title,
          link: photo.link,
          image: photo.media && photo.media.b,
          thumbnail: photo.media && photo.media.t,
          author: photo.author,
          published: photo.published,
          tags: photo.tags
        }));
        return jsonResult({ count: results.length, photos: results });
      });
    }
  );

  server.registerTool(
    'list-archives',
    {
      title: 'List existing archives',
      description:
        'List the zip archives already generated (from Firebase), newest first.'
    },
    () => {
      return firebaseDb.listJobs().then(jobs => {
        const archives = jobs.map(job => ({
          tags: job.tags,
          storagePath: job.storagePath,
          gsUri: job.gsUri,
          createdAt: job.createdAt,
          createdAtIso: job.createdAt
            ? new Date(job.createdAt).toISOString()
            : null
        }));
        return jsonResult({ count: archives.length, archives: archives });
      });
    }
  );

  server.registerTool(
    'get-archive-download-url',
    {
      title: 'Get an archive download URL',
      description:
        'Return a fresh temporary (signed) download URL for a zip that was ' +
        'already generated, identified by the tags it was created for.',
      inputSchema: z.object({
        tags: z
          .string()
          .min(1)
          .describe('The tags the archive was created for')
      })
    },
    args => {
      return firebaseDb.listJobs().then(jobs => {
        // listJobs() is newest-first, so this is the most recent match.
        const match = jobs.find(job => job.tags === args.tags);
        if (!match || !match.storagePath) {
          return textResult(
            'No archive found for tags "' + args.tags + '".',
            true
          );
        }
        return zipJob.getSignedUrl(match.storagePath).then(url => {
          return jsonResult({
            tags: match.tags,
            storagePath: match.storagePath,
            createdAt: match.createdAt,
            downloadUrl: url
          });
        });
      });
    }
  );
}

// One instance, wired up once (the SDK example creates the server outside the
// request handler and connects a fresh transport to it per request).
function createMcpServer() {
  const server = new McpServer({ name: 'lead-tech-mcp', version: '1.0.0' });
  registerTools(server);
  return server;
}

module.exports = { createMcpServer, registerTools };
