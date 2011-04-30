#!/usr/bin/env node

/* Copyright 2011 (c) Trent Mick.
 * Copyright 2011 (c) Joyent Inc.
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

var gitteh = require('gitteh');
var chaingang = require('chain-gang');
var base64_encode = require('base64').encode;
var Mustache = require('mustache');
var _ = require('underscore');


//--- exports for module usage
//  var app = require('./app.js');
//  app.main();

exports.main = main;



//---- globals && config

var config = null;
var db;  // see "Database" below
var chain = chaingang.create({workers: 3})

const MUSTACHE_VIEW_DEBUG = true;
var templatesDir = __dirname + '/templates';




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
  
  app.get('/api/repos', function(req, res) {
    jsonResponse(res, {repositories: _.values(db.repoFromName)});
  });
  app.get('/api/repos/:repo', function(req, res) {
    var repo = db.repoFromName[req.params.repo];
    if (repo === undefined) {
      jsonResponse(res, {
        error: {
          message: "no such repo: '"+req.params.repo+"'",
          code: 404
        }
      }, 404);
    } else {
      jsonResponse(res, {repository: repo});
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

    jsonResponse(res, {repository: repo});
  });
  
  // GET /api/repos/:repo/ref/:ref[/:path]
  app.get(/^\/api\/repos\/([^\/]+)\/ref\/([^\/\n]+)(\/.*?)?$/, function(req, res) {
    var name = req.params[0];
    var refSuffix = req.params[1];
    var path = pathFromRouteParam(req.params[2]);

    // 1. Determine the repo.
    var repo = db.repoFromName[name];
    if (repo === undefined) {
      return jsonErrorResponse(res, "no such repo: '"+name+"'", 404);
    }
    //TODO:XXX: handle the repo still cloning.
    
    // 2. Determine the full ref string.
    repo.tags(function(err, tags) {
      if (err) {
        return jsonErrorResponse(res,
          "error getting tags for repo '"+repo.name+"'", 500, err);
      }
      var refString;
      // If there is a tag and head with the same name, the tag wins here.
      // TODO: is that reasonable?
      if (tags.indexOf(refSuffix) != -1) {
        refString = 'refs/tags/' + refSuffix;
      } else {
        refString = 'refs/heads/' + refSuffix;
      }
      
      // 3. Get the data for this repo, refString and path.
      getGitObject(repo, refString, path, function(err, obj) {
        if (err) {
          //TODO:XXX 404 if path just not found
          jsonErrorResponse(res,
            "error getting git object: repo='"+repo.name+"' ref='"+refString+"' path='"+path+"'",
            500, err);
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
    mustacheResponse(res, "index.mustache", view)
  });

  // GET /:repo
  // GET /:repo/tree/:ref[/:path]
  app.get(/^\/([^\/]+)(\/tree\/([^\/\n]+)(\/.*?)?)?$/, function(req, res) {
    var name = req.params[0];
    var repo = db.repoFromName[name];
    if (repo === undefined) {
      mustache404Response(res, req.path);
      return;
    }

    var defaultBranch = 'master'; //TODO: how to determine default branch?
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
      dir = dir.slice(0, dir.lastIndexOf('/'));
      if (dir.lastIndexOf('/') == -1) {
        break;
      }
    }
    breadcrumbs.push({name: repo.name, href: '/'+repo.name, dir: true});
    breadcrumbs.reverse();
    
    var view = {
      repository: repo,
      breadcrumbs: breadcrumbs
    }
    //TODO: handle proper ref (might be tag) from repo.branchesAndTags result
    var refString = 'refs/heads/'+refSuffix
    getGitObject(repo, refString, path, function(err, obj) {
      if (err) {
        mustacheResponse(res, "500.mustache", {
          error: "Error getting git object: repo='"+repo.name+"' ref='"+refString+"' path='"+path+"'",
          details: JSON.stringify(err, null, 2)
        }, 500)
        return
      }
      //TODO: redir to blob if not a tree
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
      mustacheResponse(res, "repo.mustache", view);
    })
  });
  
  // GET /:repo/blob/:ref[/:path]
  app.get(/^\/([^\/]+)\/blob\/([^\/\n]+)(\/.*?)?$/, function(req, res) {
    var name = req.params[0];
    var repo = db.repoFromName[name];
    if (repo === undefined) {
      mustache404Response(res, req.path);
      return;
    }

    var refSuffix = req.params[1];
    var path = pathFromRouteParam(req.params[2]);

    // Breadcrumbs.
    var breadcrumbs = [{name: Path.basename(path)}];
    var dir = path;
    while (dir) {
      dir = dir.slice(0, dir.lastIndexOf('/'));
      if (dir.lastIndexOf('/') == -1) {
        break;
      }
      breadcrumbs.push({
        name: Path.basename(dir),
        href: '/' + repo.name + '/tree/' + refSuffix + '/' + dir,
        dir: true
      });
    }
    breadcrumbs.push({name: repo.name, href: '/'+repo.name, dir: true});
    breadcrumbs.reverse();
    
    var view = {
      repository: repo,
      breadcrumbs: breadcrumbs
    }
    //TODO: handle proper ref (might be tag) from repo.branchesAndTags result
    var refString = 'refs/heads/'+refSuffix
    getGitObject(repo, refString, path, function(err, obj) {
      if (err) {
        mustacheResponse(res, "500.mustache", {
          error: "Error getting git object: repo='"+repo.name+"' ref='"+refString+"' path='"+path+"'",
          details: JSON.stringify(err, null, 2)
        }, 500)
        return
      }
      
      if (obj.blob === undefined && obj.tree !== undefined) {
        res.redirect('/'+name+'/tree/'+refSuffix+'/'+path);
        return;
      }
      if (looksLikeUtf8(obj.blob.data)) {
        //TODO:XXX guard against failure later in document
        view.text = decodeURIComponent(escape(obj.blob.data));
      } else {
        //TODO:XXX
        warn("XXX nope, not utf8")
      }
      mustacheResponse(res, "blob.mustache", view);
    })
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
  }
  
  Repository.prototype.refs = function refs(callback) {
    //TODO: cache these?
    this.api.listReferences(gitteh.GIT_REF_LISTALL, callback);
  }
  Repository.prototype.tags = function tags(callback) {
    var PREFIX = "refs/tags/";
    this.refs(function(err, refs) {
      if (err) { callback(err) }
      refs = refs.filter(function(s) { return s.slice(0, PREFIX.length) === PREFIX });
      refs = refs.map(function(s) { return s.slice(PREFIX.length) });
      callback(null, refs);
    });
  }
  Repository.prototype.branches = function branches(callback) {
    var PREFIX = "refs/heads/";
    this.refs(function(err, refs) {
      if (err) { callback(err) }
      refs = refs.filter(function(s) { return s.slice(0, PREFIX.length) === PREFIX });
      refs = refs.map(function(s) { return s.slice(PREFIX.length) });
      callback(null, refs);
    });
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
 */
function getGitObject(repo, refString, path, callback) {
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
            tree: tree
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
              blob: blob
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
      var pathParts = (path ? path.split('/') : []);
      getGitEntry(repo, commit.tree, pathParts, path);
    });
  }
  
  function onRef(err, ref) {
    if (err) {
      callback({
        error: "error looking up reference for '"+refString+"'",
        details: err
      });
      return;
    }
    if (ref.type === gitteh.GIT_REF_OID) {
      onCommitRef(ref);
    } else if (ref.type === gitteh.GIT_REF_SYMBOLIC) {
      ref.resolve(onRef);
    } else {
      callback({error: "Unknown reference type for '"+refString+"': "+ref.type});
    }
  }

  repo.api.getReference(refString, onRef);
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
      var err = new Error("git " + fullArgs.join(" ") + "\n" + stderr.join(''));
      if (gitENOENT.test(err.message)) {
        err.errno = process.ENOENT;
      }
      callback(null, stdout.join(''), stderr.join(''));
      return;
    }
    callback(null, stdout.join(''), stderr.join(''));
  });
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


function mustache404Response(res, path) {
  mustacheResponse(res, "404.mustache", {path: path}, 404);
}

// Render the given template path and responding with that.
//
// If the global 'MUSTACHE_VIEW_DEBUG === true' or the 'debug' argument is
// true, then a `debug` variable is added to the view. It is a JSON repr
// of the `view`. You may use `debug === false` to override the global.
function mustacheResponse(res, templatePath, view, status /* =200 */, debug /* =null */) {
  if (!status) { status = 200; }
  if (debug === undefined) { debug = null; }
  
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
    res.end(Mustache.to_html(template, view));
  });
}

function jsonErrorResponse(res, message, code, details) {
  var e = {error: {message: message, code: code}};
  if (details) {
    e.error.details = details;
  }
  return jsonResponse(res, e, code);
}

function jsonResponse(res, data, status) {
  if (status === undefined) {
    status = 200;
  }
  body = JSON.stringify(data, null, 2) + '\n';
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': body.length
    });
  res.end(body);
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


function warn(o) {
  console.warn(o);
}
function log(o) {
  console.log(o);
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
  dataDir = createDataArea(config);
  db.load();

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
