#!/usr/bin/env node

/* Copyright 2011 (c) Trent Mick.
 *
 * Molybdenum server -- a tree view for git repos.
 *
 * Usage:
 *    node app.js
 */

require.paths.unshift(__dirname + '/node_modules');

var express = require('express');
var iniparser = require('iniparser');
var fs = require('fs');
var sys = require('sys');
var Path = require('path');
var child_process = require('child_process');
var assert = require('assert');
var http = require('http');

var git = require('trentm-git');
var chaingang = require(__dirname + '/node_modules/chain-gang/lib/index.js');
var base64_encode = require('base64').encode;
var Mustache = require('mustache');
var datetime = require('trentm-datetime');
var _ = require('underscore');
var mime = require('mime');
var hashlib = require('trentm-hashlib');
var rimraf = require('rimraf');

var createAuth = require('./lib/auth').createAuth;



//--- exports for module usage
//  var app = require('./app.js');
//  app.main();

exports.main = main;



//---- globals && config

var log = console.log;

var config = null;
var db;  // see "Database" below
var chain = chaingang.create({workers: 3})

const MUSTACHE_VIEW_DEBUG = false;
var templatesDir = __dirname + '/templates';
var templatePartials;
var defaultView;



//---- app

function createApp(opts, config) {
  //-- Authentication setup
  
  var skipAuthPaths = {
    "/logout": true,
    "/api/ping": true
  };

  var auth, basicAuthMiddleware, authPublicAnonymousUser;
  if (config.authMethod === "public") {
    authPublicAnonymousUser = (config.authPublicAnonymousUser
      ? JSON.parse(config.authPublicAnonymousUser)
      : null);
  } else {
    auth = createAuth(config);
    basicAuthMiddleware = express.basicAuth(function (username, password, cb) {
      auth.authenticate(username, password, cb);
    });
  }
  function authMiddleware(req, res, next) {
    if (skipAuthPaths[req.url] !== undefined) {
      next();
    } else if (config.authMethod === "public") {
      if (authPublicAnonymousUser) {
        req.remoteUser = authPublicAnonymousUser
      } else if (req.headers["x-authorized-user"]) {
        try {
          req.remoteUser = JSON.parse(req.headers["x-authorized-user"]);
        } catch(ex) {
          return mustache500Response(res,
            "Error parsing 'X-Authorized-User' header: '"+req.headers["x-authorized-user"]+"'");
        }
      } else {
        return mustache500Response(res,
          "Error determine user info: no 'authPublicAnonymousUser' config setting and no 'X-Authorized-User' header");
      }
      next();
    } else {
      basicAuthMiddleware(req, res, next);
    }
  }

  function authorizeUsersMiddleware(req, res, next) {
    if (skipAuthPaths[req.url] !== undefined) {
      //log("Skip authorization (path '%s').", req.url);
      next();
    } else if (!config.authAuthorizedUsers
        || Object.keys(config.authAuthorizedUsers).length === 0) {
      // Empty 'authAuthorizedUsers' means, allow all.
      log("Authorize user (allow all).");
      next();
    } else if (!req.remoteUser) {
      mustache500Response(res,
        "Unauthenticated user (`req.remoteUser` is not set).");
    } else if (config.authAuthorizedUsers.hasOwnProperty(req.remoteUser.login)
        || (req.remoteUser.uuid
            && config.authAuthorizedUsers.hasOwnProperty(req.remoteUser.uuid))) {
      //log("Authorize user '%s' (%s).", req.remoteUser.login,
      //  (req.remoteUser.uuid || "<no uuid>"));
      next();
    } else {
      log("Deny user '%s' (%s).", req.remoteUser.login,
        (req.remoteUser.uuid || "<no uuid>"));
      mustache403Response(res, req.remoteUser);
    }
  }


  //-- Configure app
  
  var app;
  switch (config.protocol) {
  case "http":
    app = express.createServer();
    break;
  case "https":
    app = express.createServer({
      key: fs.readFileSync(config.sslKeyFile),
      cert: fs.readFileSync(config.sslCertFile)
    });
    break;
  default:
    throw new Error("error: unknown 'config.protocol': '"+config.protocol+"'");
    return;
  }

  express.logger.token('user', function(req, res) {
    return (req.remoteUser ? req.remoteUser.login : '-');
  });
  app.configure(function() {
    // 'favicon' above 'logger' to not log favicon requests.
    app.use(express.favicon(__dirname + '/static/favicon.ico'));
    app.use(function (req, res, next) {
      res.removeHeader("X-Powered-By");
      next();
    });
    app.use(express.static(__dirname + '/static'));
    app.use(express.logger({ format: '[:date] :status :method :url (:user, :response-time ms)' }));
    //XXX:TODO turn this on
    //express.conditionalGet()
  });

  app.configure('development', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  });

  app.configure('production', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
    //app.use(express.errorHandler());
  });

  app.configure(function() {
    app.use(authMiddleware);
    app.use(authorizeUsersMiddleware);
  });


  //-- API Routes.
  app.get('/api', function(req, res) {
    var accept = req.header("Accept");
    if (accept && (accept.search("application/xhtml+xml") != -1
                   || accept.search("text/html") != -1)) {
      mustacheResponse(res, "/../docs/api.html",
        {url: "http://"+config.host+":"+config.port},
        null, false);
    } else {
      res.header("Content-Type", "application/json")
      res.sendfile(__dirname + "/docs/api.json");
    }
  });

  app.get('/api/ping', function(req, res) {
    jsonResponse(res, {"ping": "pong"});
  });

  app.get('/api/repos', function(req, res) {
    jsonResponse(res, {
      repositories: _.values(db.repoFromName).map(
        function(r) { return r.getPublicObject() })
    }, 200);
  });

  app.get('/api/repos/:repo', function(req, res) {
    var repo = db.repoFromName[req.params.repo];
    if (repo === undefined) {
      jsonErrorResponse(res, "no such repo: '"+req.params.repo+"'", 404);
    } else {
      jsonResponse(res, {repository: repo.getPublicObject()}, 200);
    }
  });

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

    var repo = db.repoFromName[repoName] || db.addRepo(repoName, repoUrl);
    repo.fetch();

    jsonResponse(res, {repository: repo.getPublicObject()}, 200);
  });

  app.del('/api/repos/:repo', function(req, res) {
    var repo = db.repoFromName[req.params.repo];
    if (repo === undefined) {
      jsonErrorResponse(res, "no such repo: '"+req.params.repo+"'", 404);
      return;
    }
    db.removeRepo(repo.name, function(err) {
      if (err) {
        jsonErrorResponse(res, "Internal error removing repo: "+err, 500, err);
        return;
      }
      noContentResponse(res);
    });
  });

  // GET /api/repos/:repo/refs
  app.get('/api/repos/:repo/refs', function(req, res) {
    var moRepo = db.repoFromName[req.params.repo];
    if (moRepo === undefined) {
      jsonErrorResponse(res, "no such repo: '"+req.params.repo+"'", 404);
    } else {
      moRepo.refs(function(err, refs) {
        if (err) {
          jsonErrorResponse(res, "error getting refs for repo: '"+name+"'",
            500, err);
          return;
        }
        jsonResponse(res, refs);
      })
    }
  });
  
  //TODO:XXX document this
  // GET /api/repos/:repo/commits/:branch
  app.get('/api/repos/:repo/commits/:branch', function(req, res) {
    // 1. Determine the repo.
    var moRepo = db.repoFromName[req.params.repo];
    if (moRepo === undefined) {
      jsonErrorResponse(res, "no such repo: '"+name+"'", 404);
      return;
    }
    //TODO:XXX: handle the repo still cloning.

    var branch = req.params.branch;
    var limit;
    if (req.query.limit) {
      limit = Number(req.query.limit);
    }
    if (isNaN(limit)) {
      limit = 40;
    }
    var offset;
    if (req.query.offset) {
      offset = Number(req.query.offset);
    }
    if (isNaN(offset)) {
      offset = 0;
    }
    moRepo.commits(branch, limit, offset, function(err, commits) {
      if (err) {
        return jsonErrorResponse(res,
          "error getting commits for repo '"+moRepo.name+"'", 500, err);
      }
      jsonResponse(res, {
        branch: branch,
        limit: limit,
        offset: offset,
        commits: commits
      });
    });
  });

  // GET /api/repos/:repo/commit/:commitish-or-ref
  app.get('/api/repos/:repo/commit/:id', function(req, res) {
    // 1. Determine the repo.
    var moRepo = db.repoFromName[req.params.repo];
    if (moRepo === undefined) {
      jsonErrorResponse(res, "no such repo: '"+name+"'", 404);
      return;
    }
    //TODO:XXX: handle the repo still cloning.

    var id = req.params.id;
    moRepo.commit(id, function(err, commit) {
      if (err) {
        return jsonErrorResponse(res,
          "error getting commit '"+id+"' for repo '"+moRepo.name+"'", 500, err);
      }
      if (!commit) {
        return jsonErrorResponse(res, "commit '"+id+"' not found", 404);
      }
      jsonResponse(res, {commit: commit});
    });
  });

  // GET /api/repos/:repo/refs/:ref[/:path]
  app.get(/^\/api\/repos\/([^\/]+)\/refs\/([^\/\n]+)(\/.*?)?$/, function(req, res) {
    var name = req.params[0];
    var ref = req.params[1];
    var path = pathFromRouteParam(req.params[2]);

    // 1. Determine the repo.
    var moRepo = db.repoFromName[name];
    if (moRepo === undefined) {
      return jsonErrorResponse(res, "no such repo: '"+name+"'", 404);
    }
    //TODO:XXX: handle the repo still cloning.

    moRepo.blobOrTree(ref, path, function (err, blobOrTree) {
      if (err) {
        return jsonErrorResponse(res,
          "error getting '"+path+"' from repo '"+moRepo.name+"' (ref '"+ref+"')",
          500, err);
      }
      blobOrTree.ref = ref;
      blobOrTree.path = path;
      if (blobOrTree.tree) {
        blobOrTree.type = "tree"
      } else {
        blobOrTree.type = "blob"
        blobOrTree.blob.looksLikeUtf8 = looksLikeUtf8(blobOrTree.blob.data);
        blobOrTree.blob.data = base64_encode(blobOrTree.blob.data)
      }
      jsonResponse(res, blobOrTree, 200);
    });
  });


  app.get('/api/commit/:id', function(req, res) {
    var id = req.params.id;
    db.lookupCommit(id, function(err, moRepo, moCommit) {
      if (err) {
        jsonErrorResponse(res, "Internal error finding commit '"+id+"'.", 500);
      } else if (moCommit) {
        jsonResponse(res, {repository: moRepo, commit: moCommit}, 200);
      } else {
        jsonErrorResponse(res, "Commit '"+id+"' not found.", 404);
      }
    });
  });


  //---- HTML Routes

  // Hack endpoint to force browser to drop basic-auth creds. You have
  // to hit this, escape out of the auth modal dialog, then *manually*
  // go to one of the real URLs.
  // TODO: investigate possible hacks with JS (XHR), track multiple
  //    requests to this from same browser and redirect to '/' on second
  //    one, or frames or something. Perhaps this:
  //    <http://trac-hacks.org/wiki/TrueHttpLogoutPatch>
  app.get('/logout', function(req, res) {
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="Authorization Required"');
    res.end("Unauthorized");
  });

  app.get('/', function(req, res) {
    var view = {
      repositories: _(db.repoFromName).chain()
        .values().sortBy(function (r) { return r.name }).value()
    };
    mustacheResponse(res, "index.mustache", view);
  });

  // GET /:repo
  // GET /:repo/tree/:ref[/:path]
  app.get(/^\/([^\/]+)(\/|\/tree\/([^\/\n]+)(\/.*?)?)?$/, function(req, res) {
    var name = req.params[0];
    var moRepo = db.repoFromName[name];
    if (moRepo === undefined) {
      mustache404Response(res, req.url);
      return;
    }

    //TODO: How to determine default branch? look at
    //  github.com/libgit2/libgit2 (different default branch)
    var defaultBranch = 'master';
    var ref = req.params[2];
    var path = pathFromRouteParam(req.params[3]);
    if (path === '' && ref === defaultBranch) {
      res.redirect('/'+name);  //TODO: other than 301 status here?
      return;
    }
    if (!ref) {
      ref = defaultBranch;
    }

    // Breadcrumbs.
    var breadcrumbs = [];
    var dir = path;
    while (dir) {
      breadcrumbs.push({
        name: Path.basename(dir),
        href: '/' + moRepo.name + '/tree/' + ref + '/' + dir,
        dir: true
      });
      if (dir.lastIndexOf('/') == -1) {
        break;
      }
      dir = dir.slice(0, dir.lastIndexOf('/'));
    }
    breadcrumbs.push({name: moRepo.name, href: '/'+moRepo.name, dir: true});
    breadcrumbs.reverse();

    var view = {
      repository: moRepo,
      breadcrumbs: breadcrumbs
    }
    if (path) {
      view.title = path + " (" + moRepo.name + ") \u2014 " + config.name;
    } else {
      view.title = moRepo.name + " \u2014 " + config.name;
    }

    moRepo.refs(function(err, moRefs) {
      if (err) {
        mustache500Response(res, "error getting refs for repo  '"+moRepo.name+"'", err);
        return;
      }
      var currTag = null, currBranch = null;
      // If there is a tag and head with the same name, the tag wins here.
      // TODO: is that reasonable?
      if (moRefs.tags.indexOf(ref) != -1) {
        currTag = ref;
      } else if (moRefs.branches.indexOf(ref) != -1) {
        currBranch = ref;
      } else {
        mustache404Response(res, req.url);
        return;
      }
      view.branches = moRefs.branches.map(function(b) {
        return {
          name: b,
          href: '/' + moRepo.name + '/tree/' + b + (path ? '/'+path : ''),
          isCurr: b===currBranch
        }
      });
      view.tags = moRefs.tags.map(function(t) {
        return {
          name: t,
          href: '/' + moRepo.name + '/tree/' + t + (path ? '/'+path : ''),
          isCurr: t===currTag
        }
      });

      moRepo.blobOrTree(ref, path, function(err, blobOrTree) {
        if (err) {
          if (err.httpCode == 404) {
            return mustache404Response(res, req.url);
          } else {
            return mustache500Response(res,
              "Error getting git object: repo='" + moRepo.name +
                "' ref='" + ref + "' path='" + path + "'",
              JSON.stringify(err, null, 2));
          }
        }
        if (blobOrTree.tree === undefined && blobOrTree.blob !== undefined) {
          res.redirect('/'+name+'/blob/'+ref+'/'+path);
          return;
        }
        view.entries = _(blobOrTree.tree.entries).chain()
          .map(function(e) {
            var isDir = S_ISDIR(e.mode);
            return {
              name: e.name,
              isDir: isDir,
              href: '/' + moRepo.name + '/' + (isDir ? "tree" : "blob")
                + '/' + ref + (path ? '/'+path : '') + '/' + e.name
            }
          })
          .sortBy(function(e) { return [!e.isDir, e.name] })
          .value();
        if (blobOrTree.commit) {
          viewAddCommit(view, blobOrTree.commit, moRepo.name, true);
        }
        return mustacheResponse(res, "tree.mustache", view);
      });
    });
  });

  // GET /:repo/blob/:ref[/:path]
  // GET /:repo/raw/:ref[/:path]
  app.get(/^\/([^\/]+)\/(blob|raw)\/([^\/\n]+)(\/.*?)?$/, function(req, res) {
    var name = req.params[0];
    var moRepo = db.repoFromName[name];
    if (moRepo === undefined) {
      mustache404Response(res, req.url);
      return;
    }

    var mode = req.params[1];
    var ref = req.params[2];
    var path = pathFromRouteParam(req.params[3]);

    // Breadcrumbs.
    var breadcrumbs = [{name: Path.basename(path)}];
    var dir = path;
    while (dir) {
      if (dir.lastIndexOf('/') == -1) {
        break;
      }
      dir = dir.slice(0, dir.lastIndexOf('/'));
      breadcrumbs.push({
        name: Path.basename(dir),
        href: '/' + moRepo.name + '/tree/' + ref + '/' + dir,
        dir: true
      });
    }
    breadcrumbs.push({name: moRepo.name, href: '/'+moRepo.name, dir: true});
    breadcrumbs.reverse();

    var view = {
      title: path + " (" + moRepo.name + ") \u2014 " + config.name,
      repository: moRepo,
      breadcrumbs: breadcrumbs
    }

    moRepo.refs(function(err, moRefs) {
      if (err) {
        mustache500Response(res, "error getting refs for repo  '"+moRepo.name+"'", err);
        return;
      }
      var currTag = null, currBranch = null;
      // If there is a tag and head with the same name, the tag wins here.
      if (moRefs.tags.indexOf(ref) != -1) {
        currTag = ref;
      } else if (moRefs.branches.indexOf(ref) != -1) {
        currBranch = ref;
      } else {
        mustache404Response(res, req.url);
        return;
      }
      view.branches = moRefs.branches.map(function(b) {
        return {
          name: b,
          href: '/' + moRepo.name + '/tree/' + b + (path ? '/'+path : ''),
          isCurr: b===currBranch
        }
      });
      view.tags = moRefs.tags.map(function(t) {
        return {
          name: t,
          href: '/' + moRepo.name + '/tree/' + t + (path ? '/'+path : ''),
          isCurr: t===currTag
        }
      });


      moRepo.blobOrTree(ref, path, function(err, blobOrTree) {
        if (err) {
          if (err.httpCode == 404) {
            return mustache404Response(res, req.url);
          } else {
            return mustache500Response(res,
              "Error getting git object: repo='" + moRepo.name +
                "' ref='" + ref + "' path='" + path + "'",
              JSON.stringify(err, null, 2));
          }
        }
        if (blobOrTree.blob === undefined && blobOrTree.tree !== undefined) {
          res.redirect('/'+name+'/tree/'+ref+'/'+path);
          return;
        }
        //TODO: ?
        //X-Hub-Blob-Mode:100644
        //X-Hub-Blob-Sha:bdc7eb25c02b6fbdb092181aec37464a925e0de0
        //X-Hub-Blob-Size:1288
        //X-Hub-Blob-Type:image/gif        

        var llUtf8 = looksLikeUtf8(blobOrTree.blob.data);
        if (mode === "raw") {
          res.header("Content-Length", blobOrTree.blob.data.length)
          res.header("X-Content-Type-Options", "nosniff")
          if (llUtf8) {
            res.header("Content-Type", "text/plain; charset=utf-8")
          } else {
            var mimetype = mime.lookup(path);
            var charset = mime.charsets.lookup(mimetype);
            res.setHeader('Content-Type', mimetype + (charset ? '; charset=' + charset : ''));
          }
          res.end(blobOrTree.blob.data, "binary");
        } else {
          //log(req)
          viewAddCommit(view, blobOrTree.commit, moRepo.name, true);
          view.rawUrl = req.url.replace(/(\/[^/]+)\/blob/, '$1/raw');
          var mimetype = mime.lookup(path);
          view.isImage = (mimetype.slice(0, 'image/'.length) === 'image/')
          if (llUtf8) {
            //TODO: guard against decode failure later in document
            var text = decodeURIComponent(escape(blobOrTree.blob.data));
            viewAddForTextbox(view, "text", text, path, function (err) {
              if (err) {
                mustache500Response(res, "Internal error processing view", err);
                return;
              }
              mustacheResponse(res, "blob.mustache", view);
            });
          } else {
            mustacheResponse(res, "blob.mustache", view);
          }
        }
      });
    });
  });
  
  
  // GET /:repo/commits
  app.get('/:repo/commits', function(req, res) {
    res.redirect("/" + req.params.repo + "/commits/master");
  });

  // GET /:repo/commits/:ref
  app.get('/:repo/commits/:ref', function(req, res) {
    var name = req.params.repo;
    var moRepo = db.repoFromName[name];
    if (moRepo === undefined) {
      mustache404Response(res, req.url);
      return;
    }

    var ref = req.params.ref;
    var view = {
      repository: moRepo
    };

    moRepo.refs(function(err, moRefs) {
      if (err) {
        mustache500Response(res, "error getting refs for repo  '"+moRepo.name+"'", err);
        return;
      }
      var currTag = null, currBranch = null;
      // If there is a tag and head with the same name, the tag wins here.
      // TODO: is that reasonable?
      if (moRefs.tags.indexOf(ref) != -1) {
        currTag = ref;
      } else if (moRefs.branches.indexOf(ref) != -1) {
        currBranch = ref;
      } else {
        // Must be a commitish.
      }

      view.branches = moRefs.branches.map(function(b) {
        return {
          name: b,
          href: '/' + moRepo.name + '/commits/' + b,
          isCurr: b===currBranch
        }
      });
      view.tags = moRefs.tags.map(function(t) {
        return {
          name: t,
          href: '/' + moRepo.name + '/commits/' + t,
          isCurr: t===currTag
        }
      });
    
      // Paging
      var perPage = 40;
      var page = (Number(req.query.page) ? parseInt(req.query.page) : 1);
      var offset = 0;
      if (page > 0) {
        offset = perPage * (page - 1);
      }
      view.page = page;
      view.prevPage = (page - 1) || null;
      view.nextPage = page + 1;
      
      moRepo.commits(ref, perPage+1, offset, function(err, moCommits) {
        if (err) {
          return mustache500Response(res,
            "Error getting git commits: repo='"+moRepo.name+"' ref='"+ref+"'",
            JSON.stringify(err, null, 2));
        }
        if (!moCommits || moCommits.length === 0) {
          return mustache404Response(res, req.url);
        }
        if (moCommits.length < perPage + 1) {
          // Last page.
          view.nextPage = null;
        } else {
          moCommits.pop();
        }

        var commitsFromDate = [];
        moCommits.forEach(function (c) {
          viewCommitFromMoCommit(c, moRepo.name, true)
          var date = datetime.format(c.author.time, "%Y-%m-%d");
          var lastCommits = (commitsFromDate.length !== 0
            && commitsFromDate[commitsFromDate.length-1]);
          if (!lastCommits || lastCommits.date !== date) {
            lastCommits = {date: date, commits: []};
            commitsFromDate.push(lastCommits);
          }
          lastCommits.commits.push(c);
        });
        view.commitsFromDate = commitsFromDate;
        view.title = "Commits on " + ref + " (" + moRepo.name + ") \u2014 " + config.name;
        mustacheResponse(res, "commits.mustache", view);
      });
    });
  });

  // GET /:repo/commit/:id
  app.get('/:repo/commit/:id', function(req, res) {
    var name = req.params.repo;
    var moRepo = db.repoFromName[name];
    if (moRepo === undefined) {
      mustache404Response(res, req.url);
      return;
    }

    var id = req.params.id;
    var view = {
      repository: moRepo
    };

    moRepo.refs(function(err, moRefs) {
      if (err) {
        mustache500Response(res, "error getting refs for repo  '"+moRepo.name+"'", err);
        return;
      }
      var currTag = null, currBranch = null;
      // If there is a tag and head with the same name, the tag wins here.
      // TODO: is that reasonable?
      if (moRefs.tags.indexOf(id) != -1) {
        currTag = id;
      } else if (moRefs.branches.indexOf(id) != -1) {
        currBranch = id;
      } else {
        // Must be a commitish.
      }

      //XXX put "tree" in the view.branches,tags ? Another var for that.
      view.branches = moRefs.branches.map(function(b) {
        return {
          name: b,
          href: '/' + moRepo.name + '/tree/' + b,
          isCurr: b===currBranch
        }
      });
      view.tags = moRefs.tags.map(function(t) {
        return {
          name: t,
          href: '/' + moRepo.name + '/tree/' + t,
          isCurr: t===currTag
        }
      });
    
      moRepo.commit(id, function(err, moCommit) {
        if (err) {
          return mustache500Response(res,
            "Error getting git commit: repo='"+moRepo.name+"' id='"+id+"'",
            JSON.stringify(err, null, 2));
        }
        if (!moCommit) {
          return mustache404Response(res, req.url);
        }

        viewAddCommit(view, moCommit, moRepo.name);
        view.title = "Commit " + moCommit.id + " (" + moRepo.name + ") \u2014 " + config.name;
        //TODO: change this gitExec to `moRepo.diff()` (new).
        gitExec(["show", moCommit.id], moRepo.dir, function(err, stdout, stderr) {
          if (err) {
            //TODO: include 'data' in error. return here? error response?
            log("error: Error fetching repository '"+moRepo.name+"' ("
                + moRepo.url+") diff '"+moCommit.id+"': "+err);
          }
          var diffStart = stdout.match(/^diff/m);
          var text = (diffStart ? stdout.slice(diffStart.index) : "");
          viewAddForTextbox(view, "diff", text, ".diff", function (err) {
            if (err) {
              mustache500Response(res, "Internal error processing diff view", err);
              return;
            }
            mustacheResponse(res, "commit.mustache", view);
          });
        });
      });
    });
  });

  // GET /commit/:id
  app.get('/commit/:id', function(req, res) {
    var id = req.params.id;
    db.lookupCommit(id, function(err, moRepo, moCommit) {
      if (err) {
        mustache500Response(res, "error finding commit id '"+id+"'", err);
      } else if (moCommit) {
        var redir = "/" + moRepo.name + "/commit/" + moCommit.id;
        res.redirect(redir);
      } else {
        mustache404Response(res, req.url);
      }
    });
  });

  return app;
}


//---- Database

db = (function() {

  /**
   * Repository object for each repo in the server.
   * @argument {String} name is the repository name (and base dir).
   * @argument {String} url is the the clone URL for the repository.
   *
   * @param {String} dir is the repository clone directory.
   * @param {Boolean} cloned says whether this repo has been fully cloned yet.
   */
  function Repository(name, url) {
    this.name = name;
    if (url.indexOf('@') == -1 && Path.existsSync(url)) {
      url = Path.resolve(url);
    }
    this.url = url;
    this.dir = Path.join(config.reposDir, name + ".git");
    this.isCloned = Path.existsSync(this.dir);
    this.isFetchPending = false;
    this.numActiveFetches = 0;
    this._cache = {};
    this._gitRepoCache = null;
  }

  /**
   * Return an object with public fields for this repo, i.e. fields
   * appropriate for API responses.
   */
  Repository.prototype.getPublicObject = function getPublicObject() {
    return {
      name: this.name,
      url: this.url,
      isCloned: this.isCloned,
      isFetchPending: this.isFetchPending
    };
  }

  /**
   * Get a (possibly cached) node-git "Repo" instance. Calls:
   *    callback(err, gitRepo)
   */
  Repository.prototype._getGitRepo = function _getGitRepo(callback) {
    if (this._gitRepoCache) {
      callback(null, this._gitRepoCache);
    } else {
      new git.Repo(this.dir, {is_bare: true}, function(err, gitRepo) {
        if (err) { return callback(err) }
        this._gitRepoCache = gitRepo;
        callback(null, gitRepo);
      });
    }
  }

  /**
   * Get the refs for this repo. Calls:
   *    callback(err, refs)
   */
  Repository.prototype.refs = function refs(callback) {
    if (this._cache.refs) {
      callback(null, this._cache.refs);
    } else {
      var this_ = this;
      this._getGitRepo(function(err, gitRepo) {
        if (err) { return callback(err); }
        var refs = {};
        gitRepo.tags(function(err, gitTags) {
          if (err) { return callback(err); }
          refs.tags = gitTags.map(function (t) { return t.name });
          gitRepo.heads(function(err, gitHeads) {
            if (err) { return callback(err); }
            refs.branches = gitHeads.map(function (h) { return h.name });
            this_._cache.refs = refs;
            callback(null, refs);
          });
        });
      });
    }
  }

  function _commitFromGitCommit(gitCommit) {
    var commit = {
      id: gitCommit.id,
      message: gitCommit.message,
      author: {
        name: gitCommit.author.name,
        email: gitCommit.author.email,
        time: gitCommit.authored_date
      },
      parents: gitCommit.parents.map(function (p) { return p.id }),
      tree: gitCommit.tree.id
    };
    if (gitCommit.commiter) {
      commit.commiter = {
        name: gitCommit.commiter.name,
        email: gitCommit.commiter.email,
        time: gitCommit.commited_date
      };
    }
    return commit;
  }

  /**
   * Get commits for this repo.
   *
   * @param head {String} Which head (aka branch) from which to start,
   *    e.g. "master".
   * @param limit {Number} The max number of commits to return, e.g. 10.
   *    A limit of 0 means return all commits.
   * @param offset {Number} The commit index from which to start, e.g. 5
   *    means to skip the first 5 commits. Use this and `limit` for
   *    paging.
   *
   * Calls this on completion:
   *    callback(err, commits)
   */
  Repository.prototype.commits = function commits(head, limit, offset, callback) {
    if (limit === 0) {
      limit = Infinity;
    }
    var this_ = this;
    this._getGitRepo(function(err, gitRepo) {
      if (err) { return callback(err); }
      gitRepo.commits(head, limit, offset, function(err2, gitCommits) {
        if (err2) {
          try { callback(err2); } catch (e) { log(e.stack || e) }
          return;
        }
        if (!gitCommits) {
          try { callback(null, null); } catch (e) { log(e.stack || e) }
          return;
        }
        var commits = gitCommits.map(_commitFromGitCommit);
        try { callback(null, commits); } catch(e) { log(e.stack || e) }
      });
    });
  }

  /**
   * Get the given commit. Calls:
   *    callback(err, commit)
   */
  Repository.prototype.commit = function commit(id, callback) {
    var this_ = this;
    this._getGitRepo(function(err, gitRepo) {
      if (err) { return callback(err); }
      gitRepo.commit(id, function(err2, gitCommit) {
        if (err2) {
          try { callback(err2); } catch (e) { log(e.stack || e) }
          return;
        }
        if (!gitCommit) {
          try { callback(null, null); } catch (e) { log(e.stack || e) }
          return;
        }
        var commit = _commitFromGitCommit(gitCommit);
        try { callback(null, commit); } catch(e) { log(e.stack || e) }
      });
    });
  }

  /**
   * Get the blob or tree for the given ref and path. Calls:
   *    callback(err, blobOrTree)
   */
  Repository.prototype.blobOrTree = function blobOrTree(ref, path, callback) {
    var this_ = this;
    this_.commit(ref, function(err, commit) {
      if (err) { return callback(err); }
      if (!commit) { return callback({error: "no such commit: "+ref}) }
        
      var gitRepo = this._gitRepoCache;
      var pathParts = (path ? path.split('/') : []);
      
      function resolvePathPart(treeId) {
        //log("-- resolvePathPart:", treeId, pathParts)
        gitRepo.tree(treeId, function(err, gitTree) {
          if (err) {
            return callback({
              error: "error getting tree '"+treeId+'"',
              details: err
            });
          }
          if (pathParts.length == 0) {
            return callback(null, {
              commit: commit,
              tree: {
                id: gitTree.id,
                entries: gitTree.contents.map(function (e) {
                  return {
                    id: e.id,
                    name: e.name,
                    mode: e.mode
                  }
                })
              }
            })
          } else {
            var thisPart = pathParts.shift();
            var isLastPart = pathParts.length === 0;
            var entry = gitTree.contents
              .filter(function(e) { return e.name == thisPart })[0];
            if (!entry) {
              return callback({error: "'"+path+"' not found", httpCode: 404});
            } else if (isLastPart && !S_ISDIR(entry.mode)) {
              // Note: This is stupidly sync in node-git.
              gitRepo.blob(entry.id, function(err, gitBlob) {
                if (err) {
                  return callback({
                    error: "error getting blob id '"+entry.id+"'",
                    details: err
                  });
                }
                callback(null, {
                  commit: commit,
                  blob: {
                    id: gitBlob.id,
                    mode: gitBlob.mode,
                    data: gitBlob.data
                  }
                })
              });
            } else {
              resolvePathPart(entry.id);
            }
          }
        });
      }
      resolvePathPart(commit.tree);
    });
  }


  Repository.prototype.clone = function clone() {
    var this_ = this;
    // We use a task name "clone:$repo_name" to ensure that there is
    // only ever one clone task for a given repo.
    chain.add(cloneRepoTask(this_), "clone:"+this.name, function(err) {
      this_._cache = {};
      log("Finished clone task (repository '"+this_.name+"').");
      if (this_.isFetchPending) {
        log("Fetch is pending, start fetch (repository '"+this_.name+"').")
        this_.fetch();
      }
    });
  }

  Repository.prototype.fetch = function fetch() {
    if (! this.isCloned) {
      // Wait until clone is complete before fetching.
      this.isFetchPending = true;
    } else {
      this.isFetchPending = false;
      this.numActiveFetches += 1;
      var this_ = this;
      var timestamp = (new Date()).toISOString();
      chain.add(fetchRepoTask(this), "fetch:"+this.name+":"+timestamp, function(err) {
        this_._cache = {};
        log("Finished fetch task (repository '"+this_.name+"').");
        this_.numActiveFetches -= 1;
      });
    }
  }

  return {
    repoFromName: null,
    activeFetchesFromRepoName: {},
    pendingFetchFromRepoName: {},

    load: function load() {
      var reposJson = Path.join(config.dataDir, "repos.json");
      if (! Path.existsSync(reposJson)) {
        this.repoFromName = {};
        this.save();
      } else {
        var data, content, name, url;
        try {
          content = fs.readFileSync(reposJson);
        } catch(ex) {
          throw("error loading db: "+ex)
        }
        try {
          var data = JSON.parse(content);
        } catch(ex) {
          throw("bogus 'repos.json' content: "+ex);
        }
        this.repoFromName = {};
        for (var i=0; i < data.length; i++) {
          name = data[i].name;
          url = data[i].url;
          if (! (name in this.repoFromName)) {  // skip dupes
            this.addRepo(name, url, true);
          }
        }
        this.save();
      }
    },

    save: function save() {
      var reposJson = Path.join(config.dataDir, "repos.json");
      var repos = _.map(this.repoFromName,
        function(r) { return {name: r.name, url: r.url} });
      fs.writeFileSync(reposJson,
        JSON.stringify(repos, null, 2) + '\n');
    },

    addRepo: function addRepo(name, url, skipSave /* =false */) {
      var repo = this.repoFromName[name] = new Repository(name, url);
      this.activeFetchesFromRepoName[name] = [];
      this.pendingFetchFromRepoName[name] = false;
      if (! skipSave) {
        this.save();
      }
      if (! repo.isCloned) {
        repo.clone();
      } else {
        repo.fetch();
      }
      return repo;
    },

    /**
     * Remove the given repo.
     *
     * @param name {String} The repo name.
     * @param callback {Function} Will be called as `callback(err)` on
     *    completion. `err` will be null if successful.
     */
    removeRepo: function removeRepo(name, callback) {
      var repo = this.repoFromName[name];
      if (!repo) {
        callback("No such repository: '"+name+"'.");
        return;
      }
      delete this.repoFromName[name]
      delete this.activeFetchesFromRepoName[name];
      delete this.pendingFetchFromRepoName[name];
      rimraf(repo.dir, function(err) {
        if (err) {
          callback("Error deleting repository: "+err);
          return;
        }
        callback(null);
      });
    },

    /**
     * Look for the given commit id in all repos.
     *        callback(err, repo, commit)
     * If `err` is set, there was an internal error. Else if `commit`
     * is null, then the commit was not found. Else `commit` will be
     * set. 
     *
     * Note that if there is an error with a particular repo, that
     * will NOT be reported. This is so that a single bad apple can't
     * bring everything down. Such errors will be logged.
     */
    lookupCommit: function lookupCommit(id, callback) {
      var theRepo = null;
      var theCommit = null;
  
      //TODO: lookup in cache
  
      function _lookupCommitInRepo(moRepo, cb) {
        moRepo.commit(id, function(err, moCommit) {
          if (err) { 
            log("warning: error looking for commit in repo '%s' (%s): %s",
              moRepo.name, moRepo.dir, err);
          }
          if (moCommit) {
            theRepo = moRepo;
            theCommit = moCommit;
          }
          cb(null);
        });
      }

      asyncForEach(_.values(this.repoFromName), _lookupCommitInRepo, function (err) {
        if (err) {
          callback(err);
        } else {
          callback(null, theRepo, theCommit);
        }
      });
    },

  };
})();



//---- internal support functions

/**
 * Add a "text" field to the given mustache template view object
 * with all the necessary template vars used by the "textbox.mustache"
 * partial/widget.
 *
 * @param view {Object} A mustache template view object.
 * @param fieldName {String} The name of field to add to `view`.
 * @param text {String} The actual code text.
 * @param filename {String} Is a filename or path that is given to Pygments
 *    to guess the text type.
 * @param callback {Function} Will be called as `callback(err)` when done.
 *    "err" will be null if successful.
 */
function viewAddForTextbox(view, fieldName, text, filename, callback) {
  var obj = view[fieldName] = {
    text: text
  };

  // 'linenums_pre' is the equivalent of this:
  //    {{#code}}<span id="L{{n}}" rel="#L{{n}}">{{n}}</span>
  //    {{/code}}
  bits = [];
  var lineNumStr;
  var numLines = text.split('\n').length - 1; // -1 for trailing newline
  for (var i=0; i < numLines; i++) {
    lineNumStr = (i+1).toString();
    bits.push('<span id="L');
    bits.push(lineNumStr);
    bits.push('" rel="#L')
    bits.push(lineNumStr);
    bits.push('">');
    bits.push(lineNumStr);
    bits.push('</span>\n');
  }
  obj.linenums_pre = bits.join('');

  syntaxHighlight(text, filename, function(err, html) {
    if (err) {
      callback(err)
    } else {
      obj.html = html;
      callback(null)
    }
  });
}

/**
 * Add a "commit" field to the given mustache template view
 * object with all the necessary processed template variables
 * used by the "commitbox.mustache" partial.
 *
 * @param commit {moCommit} The object returned from `moRepo.commit()`.
 * @param repoName {String}
 * @param brief {Boolean} Add the necessary data and flags for the
 *    commitbox.mustache to render a "brief" commit box.
 *
 * Warning: This changes the given "commit" object **in-place**.
 */
//XXX viewAddCommit drop this
function viewAddCommit(view, commit, repoName, brief, name) {
  name = name || "commit";
  view[name] = viewCommitFromMoCommit(commit, repoName, brief);
}
function viewCommitFromMoCommit(commit, repoName, brief /* =false */) {
  if (brief === undefined || brief === null) brief = false;
  var c = commit;

  // Used for gravatar links.
  c.author.emailMd5 = hashlib.md5(c.author.email.toLowerCase());

  var links = [];
  if (brief) {
    links.push('commit  <a href="/' + repoName + '/commit/' + c.id + '">'
      + c.id.slice(0, 16) + '</a>');
  } else {
    links.push("commit  "+c.id.slice(0, 16));
  }
  c.parents.forEach(function(p, i) {
    links.push('parent  <a href="/' + repoName + '/commit/' + p + '">'
      + p.slice(0, 16) + '</a>');
  });
  c.links = links.join('\n');

  c.author.timeAgo = datetime.formatAgo(c.author.time);

  if (brief) {
    var line1 = c.message.split('\n', 1)[0]
    c.brief = {
      message: (line1.length > 60 ? line1.slice(0, 60) + "..." : line1),
      href: "/" + repoName + "/commit/" + c.id
    }
  }
  
  return c;
}


function fetchRepoTask(repo) {
  return function(worker) {
    //TODO: Better tmpDir naming for uniqueness.
    // See <http://lists-archives.org/git/623939-git-fetch-inside-a-bare-repo-does-nothing.html>
    // for why the '+refs/heads/...'.
    // Would instead using '--mirror' on the clone help?
    // <http://asleepfromday.wordpress.com/2008/08/27/git-clone-mirror/>
    gitExec(["fetch", "origin", "+refs/heads/*:refs/heads/*"], repo.dir, function(err, stdout, stderr) {
      if (err) {
        //TODO: include 'data' in error.
        log("error: Error fetching repository '"+repo.name+"' ("+repo.url+") in '"+repo.dir+"': "+err);
      }
      worker.finish();
    });
  }
}

function cloneRepoTask(repo) {
  return function(worker) {
    //TODO: Better tmpDir naming for uniqueness.
    var tmpDir = Path.join(config.tmpDir, repo.name+"."+process.pid)
    var args = ["clone", "--bare", repo.url, tmpDir];
    gitExec(args, null, function(err, stdout, stderr) {
      if (err) {
        log("error: Error cloning repository '"+repo.name+"' ("
          +repo.url+") to '"+tmpDir+"': "+err
          +"\n-- args: "+args+"\n-- stdout:\n"+stdout+"\n-- stderr:\n"+stderr+"\n--");
        if (Path.existsSync(tmpDir)) {
          fs.rmdirSync(tmpDir)
        }
        worker.finish();
        return;
      }
      // Don't use 'git remote add origin ...' because that fails on the
      // the git setups that *do* automatically create the 'origin' remote
      // on clone.
      args = ["config", "remote.origin.url", repo.url];
      gitExec(args, tmpDir, function(err2, stdout2, stderr2) {
        if (err2) {
          log("error: Error setting 'origin' remote on repository '"
            +repo.name+"' ("+repo.url+") to '"+tmpDir+"': "+err2
            +"\n-- args: "+args+"\n-- stdout:\n"+stdout2+"\n-- stderr:\n"+stderr2+"\n--");
          fs.rmdirSync(tmpDir)
          worker.finish();
          return;
        }
        try {
          fs.renameSync(tmpDir, repo.dir);
          repo.isCloned = true;
        } catch(ex) {
          log("error: Error moving repository '"+repo.name+"' clone from '"+
            tmpDir+"' to '"+repo.dir+"'.");
        }
        worker.finish();
      });
    });
  }
}

// Connect middleware.
function requestBodyMiddleware(req, res, next) {
  var data = '';
  req.setEncoding('utf8');
  req.on('data', function(chunk) { data += chunk; });
  req.on('end', function(){
    req.body = data;
    next();
  });
}


// From mustache.js.
function htmlEscape(s) {
  s = String(s === null ? "" : s);
  return s.replace(/&(?!\w+;)|["'<>\\]/g, function(s) {
    switch(s) {
    case "&": return "&amp;";
    case "\\": return "\\\\";
    case '"': return '&quot;';
    case "'": return '&#39;';
    case "<": return "&lt;";
    case ">": return "&gt;";
    default: return s;
    }
  });
}


// Names borrowed from Python `stat` module.
function S_IFMT(mode) {
  return mode & 0170000;
}
S_IFDIR  = 0040000
function S_ISDIR(mode) {
  if (typeof mode === 'string') {
    // If a string is given, presume an octal string.
    mode = parseInt(mode, 8);
  }
  return S_IFMT(mode) == S_IFDIR
}


// Based on git-fs' `gitExec`.
//TODO: allow 'gitDir' to be left out if null.
var gitENOENT = /fatal: (Path '([^']+)' does not exist in '([0-9a-f]{40})'|ambiguous argument '([^']+)': unknown revision or path not in the working tree.)/;
function gitExec(args, gitDir, callback) {
  var fullArgs = [];
  if (gitDir) {
    fullArgs = fullArgs.concat(["--git-dir=" + gitDir]);
  }
  fullArgs = fullArgs.concat(args);
  var child = child_process.spawn("git", fullArgs);
  var stdout = [], stderr = [];
  child.stdout.setEncoding('binary');
  child.stdout.addListener('data', function (text) {
    stdout[stdout.length] = text;
  });
  child.stderr.addListener('data', function (text) {
    stderr[stderr.length] = text;
  });
  child.addListener('exit', function (code) {
    if (code > 0) {
      log("gitExec: code "+code+": git " + fullArgs.join(" "));
      var err = new Error(stderr.join(''));
      if (gitENOENT.test(err.message)) {
        err.errno = process.ENOENT;
      }
      callback(err, stdout.join(''), stderr.join(''));
      return;
    }
    callback(null, stdout.join(''), stderr.join(''));
  });
  child.stdin.end();
}


/**
 * Syntax highlight with pygments.
 */
var PYGMENTS_HTML_PREFIX = '<div class="highlight"><pre>';
var PYGMENTS_HTML_SUFFIX = '\n</pre></div>\n';
function syntaxHighlight(content, filename, callback) {
  if (!content || content.length === 0) {
    callback(null, "");
    return;
  }

  var argv = [
    Path.join(__dirname, "deps", "pyg.py"),
    filename,
    "-"
  ];
  var child = child_process.spawn("python", argv);
  var stdout = [], stderr = [];
  child.stdout.setEncoding('binary');
  child.stdout.addListener('data', function (text) {
    stdout[stdout.length] = text;
  });
  child.stderr.addListener('data', function (text) {
    stderr[stderr.length] = text;
  });
  child.addListener('exit', function (code) {
    if (code > 0) {
      log("syntaxHighlight: code "+code+": python " + argv.join(" "));
      var err = new Error(stderr.join(''));
      callback(err, stdout.join(''));
      return;
    }
    //log("stderr: ", stderr.join(''))
    var html = stdout.join('');
    html = html.slice(PYGMENTS_HTML_PREFIX.length);
    html = html.slice(0, html.length-PYGMENTS_HTML_SUFFIX.length);

    // Munge to HTML wanted for line highlighting
    var munged = [];
    var lines = html.split(/\r\n|\n/);
    var length = lines.length;
    for (var i=0; i < length; i++) {
      munged.push('<div class="line" id="LC')
      munged.push((i+1).toString())
      munged.push('" style="background-color: transparent">')
      munged.push(lines[i])
      if (i+1 === length) {
        munged.push('</div>')
      } else {
        munged.push('<br/></div>')
      }
    }
    callback(null, munged.join(''));
  });
  child.stdin.setEncoding('utf-8')
  child.stdin.write(content);
  child.stdin.end();
}



function pathFromRouteParam(param) {
  // Cleanup/normalize path.
  var path = param;
  if (!path) {
    path = '/';
  }
  path = path.replace(/\/{2,}/, '/');  // Multiple '/'s to just one.
  path = path.slice(1); // Drop leading '/'.
  if (path[path.length-1] == '/') {
    path = path.replace(/\/*$/, '');  // Trailing '/'s.
  }
  return path;
}


function mustache500Response(res, error, details /* =null */) {
  if (details === undefined) { details = null; }
  mustacheResponse(res, "500.mustache", {
    title: "Server Error \u2014 " + config.name,
    error: error,
    details: details
  }, 500)
}

function mustache404Response(res, path) {
  mustacheResponse(res, "404.mustache", {path: path}, 404);
}

_mustache403ResponseImageIdx = 0;
function mustache403Response(res, user) {
  var images = [
    '/static/img/hb1.jpg',
    '/static/img/hb2.jpg'
  ];
  mustacheResponse(res, "403.mustache", {
      user: user,
      adminName: config.authAdminName,
      image: images[_mustache403ResponseImageIdx]
    }, 403, true);
  _mustache403ResponseImageIdx = (_mustache403ResponseImageIdx + 1) % images.length;
}

/**
 * Render the given template path and responding with that.
 *
 * If the global 'MUSTACHE_VIEW_DEBUG === true' or the 'debug' argument is
 * true, then a `debug` variable is added to the view. It is a JSON repr
 * of the `view`. You may use `debug === false` to override the global.
 *
 * @param res {Response}
 * @param templatePath {String} path to template file, relative to `templatesDir`.
 * @param view {Object} View object used in mustache template rendering
 * @param status {Integer} HTTP status. Optional (default 200).
 * @param debug {Boolean} Override MUSTACHE_VIEW_DEBUG setting for this
 *  rendering.
 */
function mustacheResponse(res, templatePath, view, status /* =200 */,
    debug /* =null */)
{
  if (!status) { status = 200; }
  if (debug === undefined) { debug = null; }

  Object.keys(defaultView).map(function(key) {
    if (view[key] === undefined) {
      view[key] = defaultView[key];
    }
  });

  fs.readFile(templatesDir + '/' + templatePath, 'utf-8', function(err, template) {
    if (err) {
      //TODO: 500.mustache and use that for rendering. Include 'err' content.
      log(err);
      res.writeHead(500, {
        "Content-Type": "text/html"
      })
      res.end("Unexpected error reading template: '"+templatePath+"'.");
      return;
    }
    if ((debug !== null ? debug : MUSTACHE_VIEW_DEBUG) && view.debug === undefined) {
      try {
        view.debug = JSON.stringify(view, null, 2);
      } catch (ex) {
        // Log it, but don't break template rendering.
        log("warning: could not add 'debug' output to view: "+ex);
      }
    }
    // TODO: content-length necessary?
    res.writeHead(status, {
      "Content-Type": "text/html"
    })
    res.end(Mustache.to_html(template, view, templatePartials));
  });
}

function jsonErrorResponse(res, message, code, details) {
  var e = {error: {message: message, code: code}};
  if (details) {
    e.error.details = details;
  }
  return jsonResponse(res, e, code);
}


/**
 * Complete a JSON HTTP response.
 *
 * @param res {HTTPResponse}
 * @param data {Object} The object to respond with. Will be encoded as JSON.
 * @param status {Number} HTTP response. Optional. Default is 200.
 * @param replacer {Function} Optional JSON replacer
 *    `function (key, value) -> value or undefined`.
 */
function jsonResponse(res, data, status /* =200 */, replacer /* =null */) {
  if (status === undefined || status === null) {
    status = 200;
  }
  if (replacer === undefined) { replacer = null; }
  body = JSON.stringify(data, replacer, 2) + '\n';
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': body.length
    });
  res.end(body);
}


function noContentResponse(res) {
  res.writeHead(204, {'Content-Length': 0});
  res.end();
}


/**
 * Run async `fn` on each entry in `list`. Call `cb(error)` when all done.
 * `fn` is expected to have `fn(item, callback) -> callback(error)` signature.
 *
 * From Isaac's rimraf.js.
 */
function asyncForEach (list, fn, cb) {
  if (!list.length) cb()
  var c = list.length
    , errState = null
  list.forEach(function (item, i, list) {
   fn(item, function (er) {
      if (errState) return
      if (er) return cb(errState = er)
      if (-- c === 0) return cb()
    })
  })
}


function printHelp() {
  sys.puts("Usage: node app.js [OPTIONS]");
  sys.puts("");
  sys.puts("The molybdenum server: a git repo browser.");
  sys.puts("");
  sys.puts("Options:");
  sys.puts("  -h, --help    print this help info and exit");
  sys.puts("  --version     print version of this command and exit");
  sys.puts("  -q, --quiet   only output errors and warnings");
  sys.puts("  -c, --config-path PATH");
  sys.puts("                Specify config file to load.");
  sys.puts("");
  sys.puts("Environment:");
  sys.puts("  HUB_CONFIG    Path to config file to load.");
}


// Parse the command-line options and arguments into an object.
function parseArgv(argv) {
  var opts = {
    args: [],
    configPath: null,
    help: false,
    quiet: false,
    version: false
  };

  // Turn '-iH' into '-i -H'.
  var a = argv.slice(2);  // drop ['node', 'scriptname']
  for (var i = 0; i < a.length; i ++) {
    if (a[i].charAt(0) === "-" && a[i].charAt(1) != '-' && a[i].length > 2) {
      var arg = a[i].replace(/^-+/, "").split("").map(function (a) {
        return "-" + a;
      });
      a.splice.apply(a, [i, 1].concat(arg));
    }
  }

  while (a.length > 0) {
    var arg = a.shift();
    switch(arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--version":
        opts.version = true;
        break;
      case "-q":
      case "--quiet":
        opts.quiet = true;
        break;
      case "-c":
      case "--config-path":
        opts.configPath = a.shift();
        break;
      default: // arguments
        opts.args.push(arg);
        break;
    }
  }

  return opts;
}

// Heuristic: If the first 1kB decodes successfully as UTF-8, then say yes.
function looksLikeUtf8(buf) {
  //TODO: Need to change for having unluckily split in the middle of
  //  a UTF-8 char. See <http://debuggable.com/posts/streaming-utf-8-with-node-js:4bf28e8b-a290-432f-a222-11c1cbdd56cb>
  try {
    decodeURIComponent(escape(buf.slice(0, Math.min(buf.length, 1024))));
    return true;
  } catch(e) {
    return false;
  }
}

function getVersion() {
  return fs.readFileSync(__dirname + "/VERSION", "utf8").trim();
}


function createDataArea(config) {
  if (!config.dataDir) {
    throw("no 'dataDir' config variable");
  }
  console.log("Setup data dir, '"+config.dataDir+"'.")
  if (! Path.existsSync(config.dataDir)) {
    throw("configured dataDir, '"+config.dataDir+"' does not exist");
  }
  config.reposDir = Path.join(config.dataDir, "repos");
  if (! Path.existsSync(config.reposDir)) {
    fs.mkdirSync(config.reposDir, 0755);
  }
  config.tmpDir = Path.join(config.dataDir, "tmp");
  if (Path.existsSync(config.tmpDir)) {
    rimraf.sync(config.tmpDir);
  }
  fs.mkdirSync(config.tmpDir, 0755);
}


function createPidFile(config) {
  // Create a PID file.
  var pidFile = config && config.pidFile;
  if (pidFile) {
    // Limitation, doesn't do "mkdir -p", so only one dir created.
    if (! Path.existsSync(Path.dirname(pidFile))) {
      fs.mkdirSync(Path.dirname(pidFile), 0755);
    }
    fs.writeFileSync(pidFile, process.pid.toString());
  }
  return pidFile;
}


function deletePidFile(config) {
  var pidFile = config && config.pidFile;
  if (pidFile && Path.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}


function loadConfig(configPath) {
  var config;
  
  var pathVarsRelativeToConfigFile = ["authStaticFile", "sslKeyFile", 
    "sslCertFile"];
  var pathVarsRelativeToCwd = ["dataDir", "pidFile"];
  
  // Resolve relative paths in vars.
  function resolveRelativePathVars(config, configDir) {
    pathVarsRelativeToConfigFile.forEach(function (name) {
      if (config[name] && config[name][0] !== '/') {
        config[name] = Path.resolve(configDir, config[name]);
      }
    });
    var cwd = process.cwd;
    pathVarsRelativeToCwd.forEach(function (name) {
      if (config[name] && config[name][0] !== '/') {
        config[name] = Path.resolve(cwd, config[name]);
      }
    });
  }
  
  var defaultConfigPath = __dirname + '/default-config/molybdenum.ini';
  log("Loading default config from '" + defaultConfigPath + "'.");
  config = iniparser.parseSync(defaultConfigPath);
  resolveRelativePathVars(config, Path.dirname(defaultConfigPath));
  
  if (! configPath) {
    configPath = process.env.MOLYBDENUM_CONFIG;
  }
  if (configPath) {
    if (! Path.existsSync(configPath)) {
      log("Config file not found: '" + configPath + "' does not exist. Aborting.");
      return 1;
    }
    log("Loading additional config from '" + configPath + "'.");
    var extraConfig = iniparser.parseSync(configPath);
    for (var name in extraConfig) {
      config[name] = extraConfig[name];
    }
    resolveRelativePathVars(config, Path.dirname(configPath));
  }
  
  // Resolve csv vars.
  var csvVars = ["authAuthorizedUsers"];
  csvVars.forEach(function (name) {
    mapping = {};
    (config[name] || "").trim().split(/\s*,\s*/).forEach(function (item) {
      item = item.trim();
      if (item.length > 0) {
        mapping[item] = true;
      }
    });
    config[name] = mapping;
  });
  //log(config)

  // Resolve boolean vars.
  var boolVars = [];
  boolVars.forEach(function (name) {
    if (!config[name] || config[name] === "false") {
      config[name] = false;
    } else if (config[name] === "true") {
      config[name] = true;
    } else {
      throw new Error("error: illegal value for boolean '"+name
        +"' config var: '"+config[name]
        +"' (must be 'true' or 'false' or empty)");
    }
  });
  
  return config;
}



//---- mainline

function internalMainline(argv) {
  var opts = parseArgv(argv);
  //log(opts);
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (opts.version) {
    sys.puts("molybdenum " + getVersion());
    return 0;
  }

  // `config` is intentionally global.
  config = loadConfig(opts.configPath);
  assert.ok(Path.existsSync(config.dataDir),
    "Data dir '"+config.dataDir+"' does not exist.");
  //log(config)

  // Setup
  var pidFile = createPidFile(config);
  createDataArea(config);
  db.load();

  // Template setup.
  templatePartials = {};
  fs.readdirSync(templatesDir + "/partials").map(function(f) {
    var path = templatesDir + "/partials/" + f;
    var name = Path.basename(f);
    name = name.slice(0, name.lastIndexOf('.'));
    templatePartials[name] = fs.readFileSync(path, 'utf-8');
  });
  defaultView = {
    title: config.name,
    name: config.name
  };

  var app = createApp(opts, config);
  app.listen(config.port, config.host);
  if (! opts.quiet) {
    log('Molybdenum listening on <%s://%s:%s> (%s mode, pid file %s).',
      config.protocol, app.address().address, app.address().port,
      app.set('env'), (pidFile || '<none>'));
  }

  // Optional redirector from http -> https.
  if (config.httpRedirect) {
    if (!(config.protocol === "https" && config.port === "443")) {
      log("warning: Not running http redirect because not "
        +"configured for https on port 443");
    } else {
      http.createServer(function(req, res) {
        res.statusCode = 302;
        res.setHeader("Location", config.httpRedirect);
        res.end();
      }).listen(80, config.host);
      log("Http -> <%s> redirect server listening in <http://%s>.", 
        config.httpRedirect, config.host);
    }
  }

  return 0;
}


function main() {
  var retval = internalMainline(process.argv);
  if (retval) {
    process.exit(retval);
  }

  process.on('SIGTERM', function () {
    deletePidFile(config);
    process.exit();
  });
  process.on('SIGINT', function () {
    deletePidFile(config);
    process.exit();
  });
}

if (require.main === module) {
  main();
}
