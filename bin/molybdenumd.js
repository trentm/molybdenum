#!/usr/bin/env node
/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 *
 * Main entry-point for the Molybdenum web service.
 */

var p = console.log;
var util = require('util');
var path = require('path');
var fs = require('fs');

var dashdash = require('dashdash');
var restify = require('restify');
var bunyan = require('bunyan');
var async = require('async');
var assert = require('assert-plus');

var loadConfig = require('../lib/config').loadConfig;
var createApp = require('../lib/app').createApp;
var objCopy = require('../lib/utils').objCopy;
var VERSION = require('../lib/common').VERSION;



//---- globals

var NAME = 'molybdenumd';
//XXX May want to make a default config path, then always need one.
//var DEFAULT_CONFIG_PATH = path.resolve(
//    __dirname, '..', 'etc', NAME + '.config.json');

var gConfig;
var gApp;
var log;



//---- internal support functions

function fatal(msg, code) {
    assert.string(msg, 'msg');
    assert.optionalNumber(code, 'code');
    code = code === undefined ? 1 : code;
    console.error(NAME + ': error: ' + message);
    process.exit(code);
}



//---- mainline

function main() {
    var options = [
        {
            name: 'version',
            type: 'bool',
            help: 'Print tool version and exit.'
        },
        {
            names: ['help', 'h'],
            type: 'bool',
            help: 'Print this help and exit.'
        },
        {
            names: ['verbose', 'v'],
            type: 'arrayOfBool',
            help: 'Verbose output. Use multiple times for more verbose.'
        },
        {
            names: ['config-file', 'f'],
            type: 'string',
            env: 'MOLYBDENUM_CONFIG',
            helpArg: 'PATH',
            help: 'Config file to load.'
        }
    ];
    var parser = dashdash.createParser({options: options});
    try {
        var opts = parser.parse(process.argv);
    } catch (e) {
        fatal(e.message, 1);
    }

    // Setup logging
    var logSrc = false;
    var logLevel = 'info';
    if (opts.verbose) {
        logSrc = true;
        if (opts.verbose.length === 1) {
            logLevel = 'debug';
        } else if (opts.verbose.length > 1) {
            logLevel = 'trace';
        }
    }
    var serializers = objCopy(restify.bunyan.serializers);
    // Add custom serializers here.
    //serializers.foo = function (foo) {
    //    // ...
    //};
    log = bunyan.createLogger({  // `log` is intentionally global.
        name: NAME,
        level: logLevel,
        src: logSrc,
        serializers: serializers
    });
    log.trace({opts: opts}, 'opts');

    // Handle exiting opts.
    if (opts.version) {
        p(NAME + ' ' + VERSION);
        process.exit(0);
    } else if (opts.help) {
        var help = parser.help({includeEnv: true}).trimRight();
        p('Molybdenum git repository browser daemon.\n'
          + '\n'
          + 'Usage:\n'
          + '    ./bin/molybdenumd.js [<options>]\n'
          + '\n'
          + 'Options:\n'
          + help);
        process.exit(0);
    }

    // Load config.
    gConfig = loadConfig({configPath: opts.config_file, log: log});
    if (!opts.verbose && gConfig.logLevel) {
        log.level(gConfig.logLevel);
        if (log.level() <= bunyan.DEBUG) {
            log.src = true;
        }
    }

    // Start the app.
    async.series([
        createAndStartApp,   // sets `theApp` global
        setupSignalHandlers
    ], function (err) {
        if (err) {
            log.error(err, 'error starting up');
            process.exit(2);
        }
        log.info('startup complete');
    });
}

function createAndStartApp(next) {
    var opts = {
        config: gConfig,
        log: log
    };
    createApp(opts, function (err, app) {
        if (err)
            return next(err);
        gApp = app;  // `gApp` is intentionally global
        gApp.listen(function () {
            var addr = gApp.server.address();
            log.info('%s listening on <http://%s:%s>.', NAME,
                addr.address, addr.port);
            next();
        });
    });
}

function setupSignalHandlers(next) {
    // Try to ensure we clean up properly on exit.
    function closeApp(callback) {
        if (gApp) {
            log.info('Closing app.');
            gApp.close(callback);
        } else {
            log.debug('No app to close.');
            callback();
        }
    }
    process.on('SIGINT', function () {
        log.debug('SIGINT. Cleaning up.');
        closeApp(function () {
            process.exit(1);
        });
    });
    next();
}


main();
