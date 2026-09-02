const formValidator = require('./form_validator');
const photoModel = require('./photo_model');
const queueProducer = require('./queue_producer');
const zipJob = require('./zip_job');
const rateLimiter = require('./rate_limiter');
const mountMcpEndpoint = require('./mcp_endpoint');

function route(app) {
  // MCP server exposed over a custom, bearer-protected /mcp endpoint.
  mountMcpEndpoint(app);

  app.get('/', (req, res) => {
    const tags = req.query.tags;
    const tagmode = req.query.tagmode;

    const ejsLocalVariables = {
      tagsParameter: tags || '',
      tagmodeParameter: tagmode || '',
      photos: [],
      searchResults: false,
      invalidParameters: false,
      zipDownloadUrl: ''
    };

    // if no input params are passed in then render the view with out querying the api
    if (!tags && !tagmode) {
      return res.render('index', ejsLocalVariables);
    }

    // validate query parameters
    if (!formValidator.hasValidFlickrAPIParams(tags, tagmode)) {
      ejsLocalVariables.invalidParameters = true;
      return res.render('index', ejsLocalVariables);
    }

    // get photos from flickr public feed api
    return photoModel
      .getFlickrPhotos(tags, tagmode)
      .then(photos => {
        ejsLocalVariables.photos = photos;
        ejsLocalVariables.searchResults = true;

        // if a zip already exists for these tags, add a temporary
        // download link (signed URL) to the page
        const zipObject = zipJob.completedJobs[tags];
        if (!zipObject) {
          return res.render('index', ejsLocalVariables);
        }

        return zipJob.getSignedUrl(zipObject).then(url => {
          ejsLocalVariables.zipDownloadUrl = url;
          return res.render('index', ejsLocalVariables);
        });
      })
      .catch(error => {
        console.error('[api] GET / failed to load photos from Flickr:', error.message);
        return res.status(500).send({ error });
      });
  });

  app.post('/zip', (req, res) => {
    const tags = req.query.tags;

    if (!tags) {
      return res.status(400).send({ error: 'missing "tags" query parameter' });
    }

    // Token bucket rate limiting, keyed by the caller's IP. Zipping is expensive
    // and the button is easy to spam, so drop abusive callers with a 429.
    const ip = rateLimiter.getClientIp(req);
    if (!rateLimiter.consume(ip)) {
      res.set(
        'Retry-After',
        String(Math.ceil(rateLimiter.REQUEST_COST / rateLimiter.REFILL_RATE))
      );
      return res.status(429).send({ error: 'too many requests, slow down' });
    }

    // Producer: push the tags onto the queue, then send the user back to the
    // results page (the download link shows up there once the zip is ready,
    // after a refresh).
    return queueProducer
      .publishZipRequest(tags)
      .then(() => {
        return res.redirect(303, '/?tags=' + encodeURIComponent(tags) + '&tagmode=all');
      })
      .catch(error => {
        return res.status(500).send({ error: error.message });
      });
  });
}

module.exports = route;
