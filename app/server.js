require('dotenv').config();

const express = require('express');
const favicon = require('serve-favicon');
const path = require('path');

const app = express();

// public assets
app.use(express.static(path.join(__dirname, 'public')));
app.use(favicon(path.join(__dirname, 'public/images', 'favicon.ico')));
app.use('/coverage', express.static(path.join(__dirname, '..', 'coverage')));

// ejs for view templates
app.engine('.html', require('ejs').__express);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');

// load route
require('./route')(app);

// consume the zip queue from this same instance (kept simple for render.com;
// in production this worker should run on a separate server)
require('./queue_consumer');

// server
const port = process.env.PORT || 3000;
app.server = app.listen(port);
console.log(`[server] Listening on http://localhost:${port}`);

module.exports = app;
