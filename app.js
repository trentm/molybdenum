#!/usr/bin/env node

/* Copyright 2011 (c) Trent Mick.
 *
 * Hub server -- a tree view for git repos.
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
var path = require('path');

var gitteh = require('gitteh');
var chaingang = require(__dirname + '/node_modules/chain-gang/lib/index.js');
var base64_encode = require('base64').encode;
var Mustache = require('mustache');
var _ = require('underscore');
var mime = require('mime');
var hashlib = require('hashlib');


//--- exports for module usage
//  var app = require('./app.js');
//  app.main();

exports.main = main;



//---- globals && config

var log = console.log;
var warn = console.warn;

var config = null;
var db;  // see "Database" below
var chain = chaingang.create({workers: 3})

const MUSTACHE_VIEW_DEBUG = false;
var templatesDir = __dirname + '/templates';
var templatePartials;
var defaultView;



//---- app

function createApp(opts, config) {
  //-- Configure app
  var app = express.createServer(
    // 'favicon' above 'logger' to not log favicon requests.
    express.favicon(__dirname + '/static/favicon.ico'),
    express.static(__dirname + '/static')
    //express.conditionalGet()
  );

  app.configure('development', function(){
    if (! opts.quiet) {
      app.use(express.logger({ format: '[:date] :status :method :url (:response-timems)' }));
    }
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  });

  app.configure('production', function(){
    if (! opts.quiet) {
      app.use(express.logger({ format: '[:date] :status :method :url (:response-timems)' }));
    }
    app.use(express.errorHandler());
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
    jsonResponse(res, {repositories: _.values(db.repoFromName)}, 200,
      jsonReplacerExcludeInternalKeys);
  });
  app.get('/api/repos/:repo', function(req, res) {
    var repo = db.repoFromName[req.params.repo];
    if (repo === undefined) {
      jsonErrorResponse(res, "no such repo: '"+req.params.repo+"'", 404);
    } else {
      jsonResponse(res, {repository: repo}, 200,
        jsonReplacerExcludeInternalKeys);
    }
  });
  app.post('/api/repos/:repo', requestBodyMiddleware, function(req, res) {
    try {
      var data = JSON.parse(req.body);
    } catch(ex) {
      jsonErrorResponse(res, "invalid JSON", 400, ex);
      return;
    }

    if (!data.repository || !data.repository.url) {
      jsonErrorResponse(res, "no repository URL given", 400);
      return;
    }
    //warn(data);
    var repo = db.repoFromName[data.repository.name]
      || db.addRepo(data.repository.name, data.repository.url);
    repo.fetch();

    jsonResponse(res, {repository: repo}, 200,
      jsonReplacerExcludeInternalKeys);
  });

  // GET /api/repos/:repo/refs
  app.get('/api/repos/:repo/refs', function(req, res) {
    var repo = db.repoFromName[req.params.repo];
    if (repo === undefined) {
      jsonErrorResponse(res, "no such repo: '"+req.params.repo+"'", 404);
    } else {
      var data = {};
      repo.refs(function(err, refs, branches, tags) {
        if (err) {
          jsonErrorResponse(res, "error getting refs for repo: '"+name+"'",
            500, err);
          return;
        }
        jsonResponse(res, {refs: refs, branches: branches, tags: tags});
      })
    }
  });

  // GET /api/repos/:repo/commit/:commitish-or-ref
  app.get('/api/repos/:repo/commit/:id', function(req, res) {
    // 1. Determine the repo.
    var repo = db.repoFromName[req.params.repo];
    if (repo === undefined) {
      jsonErrorResponse(res, "no such repo: '"+name+"'", 404);
      return;
    }
    //TODO:XXX: handle the repo still cloning.

    // 2. Determine the full ref string.
    repo.refs(function(err, refs, branches, tags) {
      if (err) {
        jsonErrorResponse(res,
          "error getting refs for repo '"+repo.name+"'", 500, err);
        return;
      }
      var refString;
      // If there is a tag and head with the same name, the tag wins here.
      // TODO: is that reasonable?
      if (tags.indexOf(req.params.id) != -1) {
        refString = 'refs/tags/' + req.params.id;
      } else if (branches.indexOf(req.params.id) != -1) {
        refString = 'refs/heads/' + req.params.id;
      } else {
        // Must be a commitish.
        refString = req.params.id;
      }

      // 3. Get the data for this repo, refString and path.
      getGitObject(repo, refString, "commit", null, function(err, commit) {
        if (err) {
          if (err.errno == process.ENOENT) {
            jsonErrorResponse(res, "commit or ref '"+refString+"' not found", 404);
          } else {
            jsonErrorResponse(res,
              "error getting git commit: repo='"+repo.name+"' ref='"+refString+"'",
              500, err);
          }
          return;
        }
        jsonResponse(res, commit);
      });
    });
  });

  // GET /api/repos/:repo/refs/:ref[/:path]
  app.get(/^\/api\/repos\/([^\/]+)\/refs\/([^\/\n]+)(\/.*?)?$/, function(req, res) {
    var name = req.params[0];
    var refSuffix = req.params[1];
    var path = pathFromRouteParam(req.params[2]);

    // 1. Determine the repo.
    var repo = db.repoFromName[name];
    if (repo === undefined) {
      jsonErrorResponse(res, "no such repo: '"+name+"'", 404);
      return;
    }
    //TODO:XXX: handle the repo still cloning.

    // 2. Determine the full ref string.
    repo.refs(function(err, refs, branches, tags) {
      if (err) {
        jsonErrorResponse(res,
          "error getting tags for repo '"+repo.name+"'", 500, err);
        return;
      }
      var refString;
      // If there is a tag and head with the same name, the tag wins here.
      // TODO: is that reasonable?
      if (tags.indexOf(refSuffix) != -1) {
        refString = 'refs/tags/' + refSuffix;
      } else if (branches.indexOf(refSuffix) != -1) {
        refString = 'refs/heads/' + refSuffix;
      } else {
        jsonErrorResponse(res, "unknown branch or tag: '"+refSuffix+"'", 404);
        return;
      }

      // 3. Get the data for this repo, refString and path.
      getGitObject(repo, refString, "entry", path, function(err, obj) {
        if (err) {
          // Pattern matching the error string is insane here... but.
          if (err.error && /'.*?' not found/.test(err.error)) {
            jsonErrorResponse(res, err.error, 404);
          } else {
            jsonErrorResponse(res,
              "error getting git object: repo='"+repo.name+"' ref='"+refString+"' path='"+path+"'",
              500, err);
          }
          return;
        }
        if (obj.tree) {
          obj.ref = refString;
          obj.path = path;
          obj.type = "tree";
          jsonResponse(res, obj);
        } else if (obj.blob) {
          obj.ref = refString;
          obj.path = path;
          obj.type = "blob";
          obj.blob.looksLikeUtf8 = looksLikeUtf8(obj.blob.data);
          obj.blob.data = base64_encode(obj.blob.data);
          jsonResponse(res, obj);
        } else {
          jsonErrorResponse(res,
            "unexpected git object: keys="+JSON.stringify(Object.keys(obj)), obj);
        }
      });
    });
  });


  //---- HTML Routes

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
    var repo = db.repoFromName[name];
    if (repo === undefined) {
      mustache404Response(res, req.url);
      return;
    }

    var defaultBranch = 'master'; //TODO: how to determine default branch? look at libgit2 (different default branch)
    var refSuffix = req.params[2];
    var path = pathFromRouteParam(req.params[3]);
    if (path === '' && refSuffix === defaultBranch) {
      res.redirect('/'+name);  //TODO: other than 301 status here?
      return;
    }
    if (!refSuffix) {
      refSuffix = defaultBranch;
    }

    // Breadcrumbs.
    var breadcrumbs = [];
    var dir = path;
    while (dir) {
      breadcrumbs.push({
        name: Path.basename(dir),
        href: '/' + repo.name + '/tree/' + refSuffix + '/' + dir,
        dir: true
      });
      if (dir.lastIndexOf('/') == -1) {
        break;
      }
      dir = dir.slice(0, dir.lastIndexOf('/'));
    }
    breadcrumbs.push({name: repo.name, href: '/'+repo.name, dir: true});
    breadcrumbs.reverse();

    var view = {
      repository: repo,
      breadcrumbs: breadcrumbs
    }
    if (path) {
      view.title = path + " (" + repo.name + ") \u2014 " + config.name;
    } else {
      view.title = repo.name + " \u2014 " + config.name;
    }

    repo.refs(function(err, refs, branches, tags) {
      if (err) {
        mustache500Response(res, "error getting refs for repo  '"+repo.name+"'", err);
        return;
      }
      var refString, currTag = null, currBranch = null;
      // If there is a tag and head with the same name, the tag wins here.
      // TODO: is that reasonable?
      if (tags.indexOf(refSuffix) != -1) {
        refString = 'refs/tags/' + refSuffix;
        currTag = refSuffix;
      } else if (branches.indexOf(refSuffix) != -1) {
        refString = 'refs/heads/' + refSuffix;
        currBranch = refSuffix;
      } else {
        mustache404Response(res, req.url);
        return;
      }
      view.branches = branches.map(function(b) {
        return {
          name: b,
          href: '/' + repo.name + '/tree/' + b + (path ? '/'+path : ''),
          isCurr: b===currBranch
        }
      });
      view.tags = tags.map(function(t) {
        return {
          name: t,
          href: '/' + repo.name + '/tree/' + t + (path ? '/'+path : ''),
          isCurr: t===currTag
        }
      });

      getGitObject(repo, refString, "entry", path, function(err, obj) {
        if (err) {
          // Pattern matching the error string is insane here... but.
          if (/'.*?' not found/.test(err.error)) {
            mustache404Response(res, req.url);
          } else {
            mustache500Response(res,
              "Error getting git object: repo='" + repo.name +
                "' ref='" + refString + "' path='" + path + "'",
              JSON.stringify(err, null, 2));
          }
          return;
        }
        //TODO: redir to blob if not a tree
        if (obj.tree === undefined && obj.blob !== undefined) {
          res.redirect('/'+name+'/blob/'+refSuffix+'/'+path);
          return;
        }
        view.entries = _(obj.tree.entries).chain()
          .map(function(e) {
            var isDir = S_ISDIR(e.attributes);
            return {
              name: e.name,
              isDir: isDir,
              href: '/' + repo.name + '/' + (isDir ? "tree" : "blob")
                + '/' + refSuffix + (path ? '/'+path : '') + '/' + e.name
            }
          })
          .sortBy(function(e) { return [!e.isDir, e.name] })
          .value();
        if (obj.commit) {
          viewAddCommit(view, obj.commit, repo.name, true);
        }
        mustacheResponse(res, "tree.mustache", view);
      });
    });
  });

  // GET /:repo/blob/:ref[/:path]
  // GET /:repo/raw/:ref[/:path]
  app.get(/^\/([^\/]+)\/(blob|raw)\/([^\/\n]+)(\/.*?)?$/, function(req, res) {
    var name = req.params[0];
    var repo = db.repoFromName[name];
    if (repo === undefined) {
      mustache404Response(res, req.url);
      return;
    }

    var mode = req.params[1];
    var refSuffix = req.params[2];
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
        href: '/' + repo.name + '/tree/' + refSuffix + '/' + dir,
        dir: true
      });
    }
    breadcrumbs.push({name: repo.name, href: '/'+repo.name, dir: true});
    breadcrumbs.reverse();

    var view = {
      title: path + " (" + repo.name + ") \u2014 " + config.name,
      repository: repo,
      breadcrumbs: breadcrumbs
    }

    repo.refs(function(err, refs, branches, tags) {
      if (err) {
        mustache500Response(res, "error getting refs for repo  '"+repo.name+"'", err);
        return;
      }
      var refString, currTag = null, currBranch = null;
      // If there is a tag and head with the same name, the tag wins here.
      // TODO: is that reasonable?
      if (tags.indexOf(refSuffix) != -1) {
        refString = 'refs/tags/' + refSuffix;
        currTag = refSuffix;
      } else if (branches.indexOf(refSuffix) != -1) {
        refString = 'refs/heads/' + refSuffix;
        currBranch = refSuffix;
      } else {
        mustache404Response(res, req.url);
        return;
      }
      view.branches = branches.map(function(b) {
        return {
          name: b,
          href: '/' + repo.name + '/tree/' + b + (path ? '/'+path : ''),
          isCurr: b===currBranch
        }
      });
      view.tags = tags.map(function(t) {
        return {
          name: t,
          href: '/' + repo.name + '/tree/' + t + (path ? '/'+path : ''),
          isCurr: t===currTag
        }
      });

      getGitObject(repo, refString, "entry", path, function(err, obj) {
        if (err) {
          // Pattern matching the error string is insane here... but.
          if (/'.*?' not found/.test(err.error)) {
            mustache404Response(res, req.url);
          } else {
            mustache500Response(res,
              "Error getting git object: repo='" + repo.name +
                "' ref='" + refString + "' path='" + path + "'",
              JSON.stringify(err, null, 2));
          }
          return;
        }

        if (obj.blob === undefined && obj.tree !== undefined) {
          res.redirect('/'+name+'/tree/'+refSuffix+'/'+path);
          return;
        }
        //TODO: ?
        //X-Hub-Blob-Mode:100644
        //X-Hub-Blob-Sha:bdc7eb25c02b6fbdb092181aec37464a925e0de0
        //X-Hub-Blob-Size:1288
        //X-Hub-Blob-Type:image/gif

        var llUtf8 = looksLikeUtf8(obj.blob.data);
        if (mode === "raw") {
          res.header("Content-Length", obj.blob.data.length)
          res.header("X-Content-Type-Options", "nosniff")
          if (llUtf8) {
            res.header("Content-Type", "text/plain; charset=utf-8")
          } else {
            var mimetype = mime.lookup(path);
            var charset = mime.charsets.lookup(mimetype);
            res.setHeader('Content-Type', mimetype + (charset ? '; charset=' + charset : ''));
          }
          res.end(obj.blob.data, "binary");
        } else {
          //warn(req)
          viewAddCommit(view, obj.commit, repo.name, true);
          view.rawUrl = req.url.replace(/(\/[^/]+)\/blob/, '$1/raw');
          var mimetype = mime.lookup(path);
          view.isImage = (mimetype.slice(0, 'image/'.length) === 'image/')
          if (llUtf8) {
            //TODO: guard against decode failure later in document
            var text = decodeURIComponent(escape(obj.blob.data));
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

  // GET /:repo/commit/:id
  app.get('/:repo/commit/:id', function(req, res) {
    var name = req.params.repo;
    var repo = db.repoFromName[name];
    if (repo === undefined) {
      mustache404Response(res, req.url);
      return;
    }

    var id = req.params.id;
    var view = {
      repository: repo
    };

    repo.refs(function(err, refs, branches, tags) {
      if (err) {
        mustache500Response(res, "error getting refs for repo  '"+repo.name+"'", err);
        return;
      }
      var refString, currTag = null, currBranch = null;
      // If there is a tag and head with the same name, the tag wins here.
      // TODO: is that reasonable?
      if (tags.indexOf(id) != -1) {
        refString = 'refs/tags/' + id;
        currTag = id;
      } else if (branches.indexOf(id) != -1) {
        refString = 'refs/heads/' + id;
        currBranch = id;
      } else {
        // Must be a commitish.
        refString = id;
      }

      //XXX START HERE: put "tree" in the view.branches,tags ? Another var for that.
      view.branches = branches.map(function(b) {
        return {
          name: b,
          href: '/' + repo.name + '/tree/' + b,
          isCurr: b===currBranch
        }
      });
      view.tags = tags.map(function(t) {
        return {
          name: t,
          href: '/' + repo.name + '/tree/' + t,
          isCurr: t===currTag
        }
      });

      getGitObject(repo, refString, "commit", null, function(err, commit) {
        if (err) {
          if (err.errno == process.ENOENT) {
            mustache404Response(res, req.url);
          } else {
            mustache500Response(res,
              "Error getting git commit: repo='"+repo.name+"' ref='"+refString+"'",
              JSON.stringify(err, null, 2));
          }
          return;
        }
        viewAddCommit(view, commit.commit, repo.name);
        view.title = "Commit " + commit.commit.id + " (" + repo.name + ") \u2014 " + config.name,

        gitExec(["show", commit.commit.id], repo.dir, function(err, stdout, stderr) {
          if (err) {
            //TODO: include 'data' in error. return here? error response?
            warn("error: Error fetching repository '"+repo.name+"' ("
                 + repo.url+") diff '"+commit.commit.id+"': "+err);
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


  return app;
}


//---- Database

db = (function() {

  /**
   * Repository object for each repo in the hub.
   * @argument {String} name is the repository name (and base dir).
   * @argument {String} url is the the clone URL for the repository.
   *
   * @param {String} dir is the repository clone directory.
   * @param {Boolean} cloned says whether this repo has been fully cloned yet.
   */
  function Repository(name, url) {
    this.name = name;
    if (url.indexOf('@') == -1 && Path.existsSync(url)) {
      url = absPath(url);
    }
    this.url = url;
    this.dir = Path.join(config.reposDir, name + ".git");
    this.isCloned = Path.existsSync(this.dir);
    this.isFetchPending = false;
    this.numActiveFetches = 0;
    this._apiCache = null;
    this._cache = {};
  }

  /**
   * Get the refs for this repo. Calls the callback with:
   *    error, refs, branches, tags
   */
  Repository.prototype.refs = function refs(callback) {
    if (this._cache.refsInfo) {
      callback.apply(null, this._cache.refsInfo);
    } else {
      var this_ = this;
      this.api.listReferences(gitteh.GIT_REF_LISTALL, function(err, refs) {
        if (err) { callback(err) }
        refs.sort();
        refs.reverse();  // latest version number (lexographically) at the top

        var TAGS_PREFIX = "refs/tags/";
        var tags = refs.filter(function(s) { return s.slice(0, TAGS_PREFIX.length) === TAGS_PREFIX });
        tags = tags.map(function(s) { return s.slice(TAGS_PREFIX.length) });

        var HEADS_PREFIX = "refs/heads/";
        var branches = refs.filter(function(s) { return s.slice(0, HEADS_PREFIX.length) === HEADS_PREFIX });
        var branches = branches.map(function(s) { return s.slice(HEADS_PREFIX.length) });

        var refsInfo = this_._cache.refsInfo = [null, refs, branches, tags];
        callback.apply(null, refsInfo);
      });
    }
  }

  Repository.prototype.__defineGetter__("api", function() {
    if (this._apiCache === null) {
      this._apiCache = gitteh.openRepository(this.dir);
    }
    return this._apiCache;
  });

  Repository.prototype.clone = function clone() {
    var this_ = this;
    // We use a task name "clone:$repo_name" to ensure that there is
    // only ever one clone task for a given repo.
    chain.add(cloneRepoTask(this_), "clone:"+this.name, function(err) {
      this._cache = {};
      log("Finished clone task (repository '"+this_.name+"').");
      if (this_.isFetchPending) {
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
      chain.add(fetchRepoTask(this), null, function(err) {
        this._cache = {};
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
    }
  };
})();



//---- internal support functions

/* Get the referenced repository blob or tree and call `callback`:
 *
 *    callback(err, object);
 *
 * If `err` is given it will be of the form:
 *
 *    {
 *      "error": error message string
 *      "details": optional object with some error details
 *    }
 *
 * ...
 * @param type {String} What type of git object to return. Can be one of
 *    "commit" or "entry". Here "entry" means either a tree or a blob
 *    is returned depending on what the given `path` param refers to.
 * @param path {String} The path in a git tree to return. Only used
 *    if `type === "entry"`.
 * ...
 *
 */
function getGitObject(repo, commitishOrRefString, type, path, callback) {
  assert.ok(type === "commit" || type === "entry");
  var theCommit;

  function getGitEntry(repo, treeId, pathParts, path) {
    repo.api.getTree(treeId, function(err, tree) {
      if (err) {
        callback({
          error: "error getting commit tree '"+treeId+"'",
          details: err
        });
        return;
      }
      if (pathParts.length == 0) {
          callback(null, {
            tree: tree,
            commit: theCommit
          });
      } else {
        var thisPart = pathParts.shift();
        var isLastPart = pathParts.length === 0;
        var entry = tree.entries
          .filter(function(e) { return e.name == thisPart })[0];
        if (!entry) {
          callback({error: "'"+path+"' not found"});
          return;
        } else if (isLastPart && !S_ISDIR(entry.attributes)) {
          repo.api.getBlob(entry.id, function(err, blob) {
            if (err) {
              callback({
                error: "error getting blob id '"+entry.id+"'",
                details: err
              });
              return;
            }
            callback(null, {
              blob: blob,
              commit: theCommit
            });
          });
        } else {
          //TODO: assert entry.attributes shows this is a dir
          getGitEntry(repo, entry.id, pathParts, path);
        }
      }
    });
  }

  function onCommitRef(commitRef) {
    repo.api.getCommit(commitRef.target, function(err, commit) {
      if (err) {
        callback({
          error: "error getting commit '"+commitRef.target+"'",
          details: err
        });
        return;
      }
      if (type === "commit") {
        callback(null, {commit: commit});
      } else {
        var pathParts = (path ? path.split('/') : []);
        theCommit = commit;
        getGitEntry(repo, commit.tree, pathParts, path);
      }
    });
  }

  function onTagRef(tagRef) {
    repo.api.getTag(tagRef.target, function(err, tag) {
      if (err) {
        callback({
          error: "error getting tag '"+tagRef.target+"'",
          details: err
        });
        return;
      }
      //warn(sys.inspect(tag))
      if (tag.targetType === 'commit') {
        onCommitRef({target: tag.targetId})
      } else {
        callback({
          error: "unknown tag targetType, '" + tag.targetType +
            "', for tag ref '" + tagRef.target + "'"
        });
        return;
      }
    });
  }

  function onRef(err, ref) {
    if (err) {
      callback({
        error: "error looking up reference for '"+commitishOrRefString+"'",
        details: err
      });
      return;
    }
    if (ref.type === gitteh.GIT_REF_OID) {
      if (ref.name.slice(0, "refs/tags/".length) === "refs/tags/") {
        onTagRef(ref);
      } else {
        onCommitRef(ref);
      }
    } else if (ref.type === gitteh.GIT_REF_SYMBOLIC) {
      ref.resolve(onRef);
    } else {
      callback({error: "Unknown reference type for '"+commitishOrRefString+"': "+ref.type});
    }
  }

  var sha1Re = /[0-9a-f]{40}/;
  if (commitishOrRefString.indexOf('/') !== -1) {
    // Looks like a ref string, e.g. "refs/heads/master".
    repo.api.getReference(commitishOrRefString, onRef);
  } else if (sha1Re.test(commitishOrRefString)) {
    // Full sha1.
    onCommitRef({target: commitishOrRefString});
  } else {
    // Resolve with 'git rev-parse'.
    gitExec(['rev-parse', commitishOrRefString], repo.dir, function(err, stdout, stderr) {
      if (err) {
        callback({error: "Could not resolve '"+commitishOrRefString+"': "+err});
        return;
      }
      onCommitRef({target: stdout.trim()});
    });
  }
}


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
 * @param view {Object} A mustache template view object.
 * @param commit {gitteh.Commit?} The object returned from
 *    `getGitObject(..., "commit", ...).commit`.
 * @param repoName {String}
 * @param brief {Boolean} Add the necessary data and flags for the
 *    commit.mustache to render a "brief" commit box.
 * @param name {String} The name of field to add to `view`. Default is
 *    "commit".
 */
function viewAddCommit(view, commit, repoName, brief /* =false */,
                       name /* ="commit" */) {
  if (brief === undefined || brief === null) brief = false;
  name = name || "commit";
  var c = view[name] = commit;

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

  if (brief) {
    var line1 = c.message.split('\n', 1)[0]
    c.brief = {
      message: (line1.length > 60 ? line1.slice(0, 60) + "..." : line1),
      href: "/" + repoName + "/commit/" + c.id
    }
  }
}


function fetchRepoTask(repo) {
  return function(worker) {
    //TODO: Better tmpDir naming for uniqueness.
    gitExec(["fetch", "origin"], repo.dir, function(err, stdout, stderr) {
      if (err) {
        //TODO: include 'data' in error.
        warn("error: Error fetching repository '"+repo.name+"' ("+repo.url+") in '"+repo.dir+"': "+err);
      }
      worker.finish();
    });
  }
}

function cloneRepoTask(repo) {
  return function(worker) {
    //TODO: Better tmpDir naming for uniqueness.
    var tmpDir = Path.join(config.tmpDir, repo.name+"."+process.pid)
    gitExec(["clone", "--bare", repo.url, tmpDir], null, function(err, stdout, stderr) {
      if (err) {
        //TODO: include 'data' in error.
        warn("error: Error cloning repository '"+repo.name+"' ("+repo.url+") to '"+tmpDir+"': "+err);
        if (Path.existsSync(tmpDir)) {
          fs.rmdirSync(tmpDir)
        }
      } else {
        try {
          fs.renameSync(tmpDir, repo.dir);
          repo.isCloned = true;
        } catch(ex) {
          warn("error: Error moving repository '"+repo.name+"' clone from '"+
            tmpDir+"' to '"+repo.dir+"'.");
        }
      }
      worker.finish();
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
    path.join(__dirname, "deps", "pyg.py"),
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
      warn(err);
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
        warn("warning: could not add 'debug' output to view: "+ex);
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

function jsonReplacerExcludeInternalKeys(key, value) {
  if (key && key[0] === '_') {
    return undefined;
  } else {
    return value;
  }
}

function printHelp() {
  sys.puts("Usage: node app.js [OPTIONS]");
  sys.puts("");
  sys.puts("The Hub server.");
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


function absPath(p, relativeTo) {
  // Node 0.4.0 has `Path.resolve`. Switch to that when can.
  if (p[0] !== '/') {
    if (typeof(relativeTo) === "undefined") {
      relativeTo = process.cwd();
    }
    p = relativeTo + '/' + p;
  }
  return p;
}

function createDataArea(config) {
  if (!config.dataDir) {
    throw("no 'dataDir' config variable");
  }
  config.dataDir = absPath(config.dataDir);
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
    fs.rmdirSync(config.tmpDir);
  }
  fs.mkdirSync(config.tmpDir, 0755);
}

function createPidFile(config) {
  // Create a PID file.
  var pidFile = config && config.pidFile && absPath(config.pidFile);
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
  var pidFile = config && config.pidFile && absPath(config.pidFile);
  if (pidFile && Path.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}



//---- mainline

function internalMainline(argv) {
  var opts = parseArgv(argv);
  //warn(opts);
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (opts.version) {
    sys.puts("hub " + getVersion());
    return 0;
  }

  // Config loading.
  var defaultConfigPath = __dirname + '/default-config/hub.ini';
  log("Loading default config from '" + defaultConfigPath + "'.");
  // `config` is intentionally global.
  config = iniparser.parseSync(defaultConfigPath);
  var configPath = opts.configPath;
  if (! configPath) {
    configPath = process.env.HUB_CONFIG;
  }
  if (configPath) {
    if (! Path.existsSync(configPath)) {
      warn("No config file found: '" + configPath + "' does not exist. Aborting.");
      return 1;
    }
    log("Loading additional config from '" + configPath + "'.");
    var extraConfig = iniparser.parseSync(configPath);
    for (var name in extraConfig) {
      config[name] = extraConfig[name];
    }
  }
  //warn(config)

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
    console.log('Hub listening on <http://' + app.address().address
      + ':' + app.address().port + '/> (' + app.set('env')
      + ' mode, pid file ' + (pidFile || '<none>') + ').');
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
