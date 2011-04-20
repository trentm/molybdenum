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
var path = require('path');
var child_process = require('child_process');
var chaingang = require('chain-gang');
var _ = require('underscore');


//--- exports for module usage
//  var app = require('./app.js');
//  app.main();

exports.main = main;



//---- globals

var config = null;
var db;  // see "Database" below
var chain = chaingang.create({workers: 3})



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


  //-- Routes.
  app.get('/', function(req, res) {
    res.end("hi there, checkout /api");
  });
  
  app.get('/api', function(req, res) {
    var accept = req.header("Accept");
    if (accept && (accept.search("application/xhtml+xml") != -1
                   || accept.search("text/html") != -1)) {
      // TODO: interpolate "ip_address" and "port" values into this doc.
      res.sendfile(__dirname + "/docs/api.html");
    } else {
      res.header("Content-Type", "application/json")
      res.sendfile(__dirname + "/docs/api.json");
    }
  });
  app.get('/api/repos', function(req, res) {
    jsonResponse(res, _.values(db.repoFromName));
  });
  //TODO
  //app.get('/api/repos/:name', function(req, res) {
  //  jsonResponse(res, _.values(db.repoFromName));
  //});

  app.get('/api', function(req, res) {
    var accept = req.header("Accept");
    if (accept && (accept.search("application/xhtml+xml") != -1
                   || accept.search("text/html") != -1)) {
      // TODO: interpolate "host" and "port" values into this doc.
      res.sendfile(__dirname + "/docs/api.html");
    } else {
      res.header("Content-Type", "application/json")
      res.sendfile(__dirname + "/docs/api.json");
    }
  });
  
  app.post('/api/push', requestBodyMiddleware, function(req, res) {
    try {
      var data = JSON.parse(req.body);
    } catch(ex) {
      jsonResponse(res, {"success": false, "error": "invalid JSON: "+ex}, 400);
      return;
    }
    
    //TODO: validate data
    warn(data);
    var repo = db.repoFromName[data.repository.name]
      || db.addRepo(data.repository.name, data.repository.url);
    repo.fetch();

    jsonResponse(res, {"success": true}, 200);
  });

  return app;
}


//---- Database

db = (function() {

  /**
   * Repository object for each repo in the hub.
   * @argument {String} name is the repository name (and base dir).
   *
   * @param {String} dir is the repository clone directory.
   * @param {Boolean} cloned says whether this repo has been fully cloned yet.
   */
  function Repository(name, url) {
    this.name = name;
    this.url = url;
    this.dir = path.join(config.reposDir, name + ".git");
    this.isCloned = path.existsSync(this.dir);
    this.isFetchPending = false;
    this.numActiveFetches = 0;
  }

  Repository.prototype.clone = function clone() {
    var this_ = this;
    chain.add(cloneRepoTask(this_), "clone:"+this.name, function(err) {
      warn("Finished clone of repository '"+this_.name+"'.");
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
        warn("Finished fetch of repository '"+this_.name+"'.");
        this_.numActiveFetches -= 1;
      });
    }
  }

  return {
    repoFromName: null,
    activeFetchesFromRepoName: {},
    pendingFetchFromRepoName: {},

    load: function load() {
      var reposJson = path.join(config.dataDir, "repos.json");
      if (! path.existsSync(reposJson)) {
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
            this.addRepo(name, url);
          }
        }
      }
    },
    
    save: function save() {
      var reposJson = path.join(config.dataDir, "repos.json");
      var repos = _.map(this.repoFromName,
        function(r) { return {name: r.name, url: r.url} });
      fs.writeFileSync(reposJson,
        JSON.stringify(repos, null, 2) + '\n');
    },
    
    addRepo: function addRepo(name, url) {
      var repo = this.repoFromName[name] = new Repository(name, url);
      this.activeFetchesFromRepoName[name] = [];
      this.pendingFetchFromRepoName[name] = false;
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
    var tmpDir = path.join(config.tmpDir, repo.name+"."+process.pid)
    gitExec(["clone", "--bare", repo.url, tmpDir], null, function(err, stdout, stderr) {
      if (err) {
        //TODO: include 'data' in error.
        warn("error: Error cloning repository '"+repo.name+"' ("+repo.url+") to '"+tmpDir+"': "+err);
        if (path.existsSync(tmpDir)) {
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


function getVersion() {
  return fs.readFileSync(__dirname + "/VERSION", "utf8").trim();
}


function absPath(p, relativeTo) {
  // Node 0.4.0 has `path.resolve`. Switch to that when can.
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
  if (! path.existsSync(config.dataDir)) {
    throw("configured dataDir, '"+config.dataDir+"' does not exist");
  }
  config.reposDir = path.join(config.dataDir, "repos");
  if (! path.existsSync(config.reposDir)) {
    fs.mkdirSync(config.reposDir, 0755);
  }
  config.tmpDir = path.join(config.dataDir, "tmp");
  if (path.existsSync(config.tmpDir)) {
    fs.rmdirSync(config.tmpDir);
  }
  fs.mkdirSync(config.tmpDir, 0755);
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
  warn("Loading default config from '" + defaultConfigPath + "'.");
  // `config` is intentionally global.
  config = iniparser.parseSync(defaultConfigPath);
  var configPath = opts.configPath;
  if (! configPath) {
    configPath = process.env.HUB_CONFIG;
  }
  if (configPath) {
    if (! path.existsSync(configPath)) {
      warn("No config file found: '" + configPath + "' does not exist. Aborting.");
      return 1;
    }
    warn("Loading additional config from '" + configPath + "'.");
    var extraConfig = iniparser.parseSync(configPath);
    for (var name in extraConfig) {
      config[name] = extraConfig[name];
    }
  }
  //warn(config)

  // Setup
  dataDir = createDataArea(config);
  db.load();

  var app = createApp(opts, config);
  app.listen(config.port, config.host);
  if (! opts.quiet) {
    console.log('Hub listening on <http://' + app.address().address
      + ':' + app.address().port + '/> (' + app.set('env') + ' mode).');
  }
  return 0;
}


function main() {
  var retval = internalMainline(process.argv);
  if (retval) {
    process.exit(retval);
  }
}

if (require.main === module) {
  main();
}
