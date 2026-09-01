const formValidator = require('./form_validator');
const photoModel = require('./photo_model');
const queueProducer = require('./queue_producer');
const zipJob = require('./zip_job');

function route(app) {
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

        // si un zip a déjà été généré pour ces tags, on ajoute un lien de
        // téléchargement temporaire (signed URL) à la page
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
        console.log('aspdfonaposd', error)
        return res.status(500).send({ error });
      });
  });

  app.post('/zip', (req, res) => {
    const tags = req.query.tags;

    if (!tags) {
      return res.status(400).send({ error: 'missing "tags" query parameter' });
    }

    // Producer : on envoie les tags dans la queue et on répond immédiatement.
    return queueProducer
      .publishZipRequest(tags)
      .then(messageId => {
        return res.status(202).send({ status: 'queued', messageId, tags });
      })
      .catch(error => {
        return res.status(500).send({ error: error.message });
      });
  });
}

module.exports = route;
