/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 *
 * The Molybdenum API endpoints.
 */

var p = console.log;
var format = require('util').format;

var assert = require('assert-plus');
var restify = require('restify');
var async = require('async');

var errors = require('./errors');
var VERSION = require('./common').VERSION;



//---- misc. endpoints

/**
 * "GET /ping"
 */
function apiPing(req, res, next) {
    if (req.query.error !== undefined) {
        var name = req.query.error || 'InternalError';
        if (name.slice(-5) !== 'Error') {
            name += 'Error';
        }
        var err;
        if (!errors[name]) {
            err = new errors.InvalidParameterError('unknown error: '+name,
                [ {field: 'error', code: 'Missing'} ]);
        } else {
            err = errors.samples[name] || new errors.InternalError(
                format('do not have a sample "%s" error', name));
        }
        next(err);
    //} else if (req.query.delay !== undefined) {
    //    var delay = Number(req.query.delay);  // number of seconds
    //    if (isNaN(delay)) {
    //        delay = 10;
    //    }
    //    // Disable the default 2 minute timeout from node's "http.js".
    //    req.connection.setTimeout(0);
    //    req.connection.on('timeout', function () {
    //        console.log('ping timeout');
    //    })
    //    setTimeout(function () {
    //        var data = {
    //            ping: 'pong',
    //            pid: process.pid,  // used by test suite
    //            version: VERSION,
    //            delay: delay
    //        };
    //        res.send(data);
    //        next();
    //    }, delay * 1000);
    } else {
        var data = {
            ping: 'pong',
            version: VERSION,
            molybdenum: true
        };
        // The `pid` argument is used by the test suite. However, don't
        // emit that for an unauthenticate request to a public server.
        if (req.app.mode === 'dc' || req.remoteUser) {
            data.pid = process.pid;
        }
        res.send(data);
        next();
    }
}




//---- repo endpoints

function apiListRepos(req, res, next) {
    req.db.listRepos(function (err, repos) {
        if (err) {
            return next(err);
        }
        res.send(repos);
        next();
    });
}

/*
 * Security story: We want simple un-auth'd POSTs from post-receive hooks
 * and GitHub hooks (don't want to hardcode passwords there).
 */
function apiFetchRepo(req, res, next) {
    p('XXX req.body', req.body)

    // Validation
    var repoName, repoUrl;
    if (req.body.payload) {
        // GitHub hook format
        XXX
    } else if (req.body.repository) {
        // Old mo v1 format.
        repoName = req.body.repository.name;
        repoUrl = req.body.repository.url;
    } else if (req.body.name) {
        // New mo v2 format.
        repoName = req.query.name || req.body.name;
        repoUrl = req.query.url || req.body.url;
    } else {
        //XXX START HERE: appropriate error for this
        XXX
        return next(new errors.InvalidParameterError(
            format('invalid owner: given owner, "%s", does not '
                + 'match account, "%s"', data.owner, account),
            [ { field: 'owner', code: 'Invalid' } ]));
    }
    //XXX validate name/url

    var opts = {
        name: repoName,
        url: repoUrl
    };
    req.app.getOrAddRepo(opts, function (err, repo) {
        if (err)
            return next(err);
        //XXX START HERE: repo is null, implement getOrAddRepo calls
        repo.scheduleFetch();
        res.send(repo.serialize());
        next();
    });
}
/*
  app.post('/api/repos', express.bodyParser(), function(req, res) {
    var data, repoName, repoUrl;
    if (!req.body) {
      return jsonErrorResponse(res, "missing POST body", 400);
    }
    if (req.body.payload) {
      // Likely a GitHub post-receive hook POST.
      try {
        data = JSON.parse(req.body.payload);
      } catch(ex) {
        jsonErrorResponse(res, "invalid JSON", 400, ex);
        return;
      }
      repoName = data.repository.name;
      if (data.repository["private"]) {
        // For a private github URL we can't naively tack '.git'
        // on to the repo URL. We need the "git:" protocol URL.
        assert.ok(data.repository.url.indexOf("github.com") != -1)
        repoUrl = "git@github.com:"+data.repository.owner.name+"/"+data.repository.name+".git";
      } else {
        repoUrl = data.repository.url + ".git";
      }
    } else {
      data = req.body;
      if (!data.repository || !data.repository.url) {
        jsonErrorResponse(res, "no repository URL given", 400);
        return;
      }
      repoName = data.repository.name;
      repoUrl = data.repository.url;
    }

    var repo = db.repoFromName[repoName];
    if (repo) {
      // Ensure the repo URL matches up.
      if (repo.url !== repoUrl) {
        var msg = format("URL for posted '%s' repo "
          + "update does not match: existing='%s', posted='%s'", repoName,
          repo.url, repoUrl);
        // Logging manually here because current mo logging sucks: statusCode
        // in log is wrong and error response not logged.
        console.warn(msg);
        return jsonErrorResponse(res, msg, 409);
      }
    } else {
      repo = db.addRepo(repoName, repoUrl);
    }
    repo.fetch();

    jsonResponse(res, {repository: repo.getPublicObject()}, 200);
  });
*/


//---- exports

function mountEndpoints(options) {
    assert.object(options, 'options');
    assert.object(options.app, 'options.app');
    assert.object(options.server, 'options.server');
    assert.func(options.reqAuth, 'options.reqAuth');
    assert.func(options.reqPassiveAuth, 'options.reqPassiveAuth');

    var server = options.server;

    // Misc.
    server.get({path: '/api/ping', name: 'Ping'},
        options.reqPassiveAuth, apiPing);
    server.get({path: '/api/state', name: 'GetState'},
        options.reqAuth,
        function apiGetState(req, res, next) {
            res.send(req.app.getStateSnapshot());
            next();
        }
    );
    server.post({path: '/api/state', name: 'UpdateState'},
        options.reqAuth,
        function apiDropCaches(req, res, next) {
            if (req.query.action !== 'dropcaches')
                return next();
            req.app.dropCaches();
            res.send(202);
            next(false);
        },
        function invalidAction(req, res, next) {
            if (req.query.action)
                //XXX errors.CLASS
                return next(new restify.InvalidArgumentError(
                    '"%s" is not a valid action', req.query.action));
            return next(
                //XXX errors.CLASS
                new restify.MissingParameterError('"action" is required'));
        }
    );

    // Repos.
    server.get({path: '/api/repos', name: 'ListRepos'},
        options.reqPassiveAuth, apiListRepos);
    server.post({path: '/api/repos', name: 'FetchRepo'},
        options.reqPassiveAuth, apiFetchRepo);

}


module.exports = {
    mountEndpoints: mountEndpoints
};
