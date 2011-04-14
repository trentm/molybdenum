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



//--- exports for module usage
//  var app = require('./app.js');
//  app.main();

exports.main = main;



//---- globals

var config = null;



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

  return app;
}




//---- internal support functions

function validateManifest(manifest) {
  // If valid, returns null, else returns list of validation failures.
  //TODO
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

  var app = createApp(opts, config);
  app.listen(config.port, config.ip_address);
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
