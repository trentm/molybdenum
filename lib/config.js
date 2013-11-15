#!/usr/bin/env node
/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 *
 * Config file loading.
 */

var p = console.log;
var path = require('path');
var fs = require('fs');
var assert = require('assert-plus');

var errors = require('./errors');



//---- globals

var DEFAULTS_PATH = path.resolve(__dirname, '..', 'etc', 'defaults.json');



//---- exports

/**
 * Load config.
 *
 * This loads factory settings (PREFIX/etc/defaults.json) and any given
 * `configPath`. Note that this is synchronous.
 *
 * @param options {Object}
 *      - configPath {String} Optional. Path to JSON config file to load.
 *      - log {Bunyan Logger}
 * @throws {ConfigFileDoesNotExist} if a given `configPath` does not exist.
 * @throws {AssertionError} if validation fails.
 * @returns {Object} config
 */
function loadConfig(options) {
    assert.object(options, 'options');
    assert.optionalString(options.configPath, 'options.configPath');
    assert.object(options.log, 'options.log');
    var log = options.log;

    log.info('Loading default config from "%s".', DEFAULTS_PATH);
    var config = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf-8'));

    var configPath = options.configPath;
    if (configPath) {
        if (! fs.existsSync(configPath)) {
            throw new errors.ConfigFileDoesNotExist(configPath);
        }
        log.info('Loading additional config from "%s".', configPath);
        var extraConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        for (var name in extraConfig) {
            config[name] = extraConfig[name];
        }
    } else {
        config.configPath = null;
    }

    // Validation and defaults.
    assert.number(config.port, 'config.port');
    assert.optionalString(config.serverName, 'config.serverName');
    assert.optionalString(config.logLevel, 'config.logLevel');
    assert.string(config.dataDir, 'config.dataDir');
    assert.object(config.database, 'config.database');
    assert.string(config.database.type, 'config.database.type');

    // Log config (but don't put passwords in the log file).
    var censorKeys = {'password': '***', 'authToken': '***', 'pass': '***'};
    function censor(key, value) {
        var censored = censorKeys[key];
        return (censored === undefined ? value : censored);
    }
    log.info('config: %s', JSON.stringify(config, censor, 2));

    return config;
}



exports.loadConfig = loadConfig;
