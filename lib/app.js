/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 *
 * The main Molybdenum daemon application.
 */

var p = console.log;
var format = require('util').format;
var os = require('os');
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');
var http = require('http');
var https = require('https');

var assert = require('assert-plus');
var restify = require('restify');
var async = require('async');
var bunyan = require('bunyan');
var mkdirp = require('mkdirp');

var utils = require('./utils');
var database = require('./database');
var errors = require('./errors');
var api = require('./api');
var VERSION = require('./common').VERSION;
//var audit = require('./audit');



//---- globals

var HOSTNAME = os.hostname();

var faviconCache;



//---- internal support stuff

/**
 * GET /favicon.ico
 */
function endpointFavicon(req, res, next) {
    var maxAge = 86400000;
    if (faviconCache) {
        res.writeHead(200, faviconCache.headers);
        res.end(faviconCache.body);
    } else {
        var faviconPath = path.resolve(__dirname, '..', 'public',
            'favicon.ico');
        fs.readFile(faviconPath, function (err, buf) {
            if (err)
                return next(err);

            var hash = crypto.createHash('md5');
            hash.update(buf);
            faviconCache = {
                headers: {
                    'Content-Type': 'image/x-icon',
                    'Content-Length': buf.length,
                    'ETag': '"' + hash.digest('base64') + '"',
                    'Cache-Control': 'public, max-age=' + (maxAge / 1000)
                },
                body: buf
            };
            res.writeHead(200, faviconCache.headers);
            res.end(faviconCache.body);
        });
    }
}



/**
 * Return a restify middleware function for handling authentication:
 *
 * @param app {App}
 * @param passive {Boolean} Whether to be "strict" or "passive".
 *      "Passive" here means, pass through if there is no Authorization
 *      header.
 */
function getAuthMiddleware(app, passive) {
    assert.object(app, 'app');
    assert.object(app.config, 'app.config');
    var config = app.config;
    assert.object(config.auth, 'config.auth');
    assert.ok(~['none', 'basic'].indexOf(config.auth.type),
        'config.auth.type');
    assert.bool(passive, 'passive');

    if (config.auth.type === 'none') {
        return function reqNoneAuth(req, res, next) {
            if (!req.remoteUser) {
                req.remoteUser = config.auth.user || 'anonymous';
            }
            return next();
        }
    } else if (config.auth.type === 'basic') {
        // Adapted from Connect's "lib/middleware/basicAuth.js".
        var bcrypt = require('bcrypt');

        assert.optionalString(config.auth.realm, 'config.auth.realm');
        assert.object(config.auth.users, 'config.auth.users');

        var realm = config.realm || config.serverName;
        var users = config.auth.users;
        // var salt = bcrypt.genSaltSync(10);

        return function reqBasicAuth(req, res, next) {
            var authorization = req.headers.authorization;
            req.log.trace({authorization: authorization}, 'basicAuth');

            if (req.remoteUser) {
                return next();
            }
            if (!authorization) {
                if (passive) {
                    return next();
                } else {
                    res.setHeader('WWW-Authenticate',
                        'Basic realm="' + realm + '"');
                    return next(new errors.UnauthorizedError('Unauthorized'));
                }
            }

            var parts = authorization.split(' ');
            var scheme = parts[0];
            var creds = new Buffer(parts[1], 'base64').toString().split(':');

            if (scheme != 'Basic') {
                return next(new errors.BadRequestError(
                    'Unsupported Authorization scheme: "%s"', scheme));
            }

            var expectedPassHash = users[creds[0]];
            if (expectedPassHash === undefined) {
                return next(new errors.UnauthorizedError('Unauthorized'));
            }
            bcrypt.compare(creds[1], expectedPassHash, function (err, ok) {
                if (err) {
                    next(new errors.InternalError(err, 'error authorizing'));
                } else if (ok) {
                    req.remoteUser = creds[0];
                    next();
                } else {
                    next(new errors.UnauthorizedError('Unauthorized'));
                }
            });
        };
    }
}


/**
 * Modified restify.formatters.json.formatJSON to indent-2 JSON from IMGAPI.
 */
function formatJSON(req, res, body) {
    if (body instanceof Error) {
        // snoop for RestError or HttpError, but don't rely on
        // instanceof
        res.statusCode = body.statusCode || 500;
        if (body.body) {
            body = body.body;
        } else {
            body = {
                message: body.message
            };
        }
    } else if (Buffer.isBuffer(body)) {
        body = body.toString('base64');
    }

    var data = JSON.stringify(body, null, 2);
    res.setHeader('Content-Length', Buffer.byteLength(data));
    return (data);
}



//---- exports

/**
 * The Image API application.
 *
 * @param options:
 *      - config {Object} The IMGAPI config
 *      - log {Bunyan Logger}
 */
function App(options) {
    var self = this;
    assert.object(options, 'options');
    assert.object(options.config, 'options.config');
    assert.object(options.log, 'options.log');

    this.config = options.config;
    this.log = options.log;
    this.port = this.config.port;
    this.hostname = this.config.hostname;
    this.serverName = this.config.serverName || 'Molybdenum/' + VERSION;

    // Allow tuning the max number of sockets for external API calls
    http.globalAgent.maxSockets = this.config.maxSockets;
    https.globalAgent.maxSockets = this.config.maxSockets;

    var server = this.server = restify.createServer({
        name: this.serverName,
        log: this.log,
        formatters: {
            'application/json': formatJSON
        }
    });

    server.use(function (req, res, next) {
        res.on('header', function onHeader() {
            var now = Date.now();
            res.header('Date', new Date());
            res.header('Server', server.name);
            res.header('x-request-id', req.getId());
            var t = now - req.time();
            res.header('x-response-time', t);
            res.header('x-server-name', HOSTNAME);
        });
        req.app = self;
        p('XXX server.use, adding req.db', self.db)
        req.db = self.db;
        next();
    });
    server.use(restify.queryParser({mapParams: false}));
    server.use(restify.bodyParser({mapParams: false}));
    server.use(restify.requestLogger());
    server.on('after', function (req, res, route, err) {
        // Skip logging some high frequency or unimportant endpoints to key
        // log noise down.
        var method = req.method;
        var path = req.path();
        if (method === 'GET' || method === 'HEAD') {
            if (path === '/ping' ||
                path.slice(0, 6) === '/docs/')
            {
                return;
            }
        }
        // Successful GET res bodies are uninteresting and *big*.
        var body = !(method === 'GET'
            && Math.floor(res.statusCode / 100) === 2);

        restify.auditLogger({
            log: req.log.child({route: route}, true),
            body: body
        })(req, res, route, err);
    });
    server.on('uncaughtException', function (req, res, route, err) {
        req.log.error(err);
        // TODO: a la fwapi: res.send(new verror.WError(err, 'Internal error'));
        res.send(err);
    });

    var reqAuth = getAuthMiddleware(this, false);
    var reqPassiveAuth = getAuthMiddleware(this, true);

    // Misc endpoints.
    server.get({path: '/favicon.ico', name: 'Favicon'}, endpointFavicon);

    // API
    api.mountEndpoints({
        app: this,
        server: server,
        reqAuth: reqAuth,
        reqPassiveAuth: reqPassiveAuth
    });
}


/**
 * Async prep/setup for an App.
 *
 * @param callback {Function} `function (err)`.
 */
App.prototype.setup = function (callback) {
    var self = this;
    assert.func(callback, 'callback');
    async.series([
        function setupDataDir(next) {
            mkdirp(self.config.dataDir, next);
        },
        function setupDb(next) {
            database.createDatabase(self, function (err, db) {
                self.db = db;
                next(err);
            })
        },
        function fetchRepos(next) {
            self.scheduleFetchAllRepos(next);
        },
    ], callback);
};


/**
 * Gets Application up and listening.
 *
 * @param callback {Function} `function (err)`.
 */
App.prototype.listen = function listen(callback) {
    this.server.listen(this.port, this.hostname, callback);
};


App.prototype.scheduleFetchAllRepos = function scheduleFetchAllRepos(callback) {
    p('XXX TODO scheduleFetchAllRepos')
    callback();
};

App.prototype.repoFromName = function repoFromName(repoName, callback) {
    assert.string(repoName, 'repoName');
    this.db.repoFromName(repoName, callback);
};

App.prototype.getOrAddRepo = function getOrAddRepo(options, callback) {
    var self = this;
    assert.string(options.name, 'options.name');
    assert.string(options.url, 'options.url');
    self.db.repoFromName(options.name, function (err, repo) {
        if (err) {
            callback(err);
        } else if (repo) {
            // Ensure the repo URL matches up.
            if (repo.url !== options.url) {
                return next(new errors.MismatchedRepoUrl(XXX));
            }
            callback(null, repo);
        } else {
            self.db.addRepo(options, callback);
        }
    });
};

/**
 * List all repos, including just data meant for the API.
 *
 * Note: Just pass through for now, but this is where filtering out of
 * internal-only db data would happen.
 */
App.prototype.listRepos = function listRepos(callback) {
    this.db.listRepos(callback);
};


/**
 * Gather JSON repr of live state.
 */
App.prototype.getStateSnapshot = function () {
    var snapshot = {
        cache: {},
        log: {
            level: this.log.level()
        },
        // Hack: We are using the flat files internal data. Make a public
        // function for this.
        //XXX add repo *objects*
        repoNames: Object.keys(this.db._repoFromName)
    };
    return snapshot;
};


App.prototype.dropCaches = function dropCaches() {
    var self = this;
    Object.keys(self._cacheFromScope).forEach(function (scope) {
        self._cacheFromScope[scope].reset();
    });
};

/**
 * Close this app.
 *
 * @param {Function} callback called when closed. Takes no arguments.
 */
App.prototype.close = function (callback) {
    this.server.on('close', function () {
        callback();
    });
    this.server.close();
};



//---- exports

/**
 * Create and setup the app.
 *
 * @param options:
 *      - config {Object} The IMGAPI config
 *      - log {Bunyan Logger}
 * @param callback {Function} `function (err, app) {...}`.
 */
function createApp(options, callback) {
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.func(callback, 'callback');

    var app;
    try {
        app = new App(options);
    } catch (e) {
        return callback(e);
    }
    options.log.info('setup app');
    app.setup(function (err) {
        options.log.info(err, 'app setup is complete: err=%s', err);
        callback(err, app);
    });
}


module.exports = {
    createApp: createApp
};
