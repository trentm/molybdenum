/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 *
 * Molybdenum database.
 */

var p = console.log;
var format = require('util').format;
var fs = require('fs');
var path = require('path');

var assert = require('assert-plus');
var async = require('async');
var mkdirp = require('mkdirp');

var createRepo = require('./repo').createRepo;



//---- internal stuff


//---- Database base class

function Database(app) {
}
Database.prototype.setup = function setup(callback) {
    throw new Error('virtual base class')
};
Database.prototype.addRepo = function (repoData, callback) {
    throw new Error('virtual base class')
};
Database.prototype.repoFromName = function (name, callback) {
    throw new Error('virtual base class')
};
Database.prototype.listRepos = function (callback) {
    throw new Error('virtual base class')
};




//---- FlatFilesDatabase

function FlatFilesDatabase(app) {
    this.config = app.config;
    assert.object(this.config, 'config');
    assert.equal(this.config.database.type, 'flat-files');
    assert.string(this.config.database.dir, 'config.database.dir');

    this._dbFile = path.resolve(this.config.database.dir, 'repoFromName.json');
    this.log = app.log.child({component: 'db'}, true);
    //XXX log
}

/**
 * Load the database from flat files.
 *
 * @param options {Object} Optional.
 *      - `log` {Bunyan Logger} Optional.
 * @param callback {Function}
 */
FlatFilesDatabase.prototype._load = function _load(options, callback) {
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.object(options, 'options');
    assert.optionalObject(options.log, 'options.log');
    assert.func(callback, 'callback');
    var self = this;
    var log = options.log || self.log;

    this._repoFromName = {};
    fs.exists(self._dbFile, function (exists) {
        if (!exists) {
            return callback();
        }
        fs.readFile(self._dbFile, function (err, data) {
            if (err)
                return callback(err);
            try {
                var rawRepoFromName = JSON.parse(data);
            } catch (synErr) {
                return callback(synErr);
            }
            var names = Object.keys(rawRepoFromName);
            for (var i = 0; i < names.length; i++) {
                self._repoFromName[names[i]]
                    = createRepo(rawRepoFromName[names[i]]);
            }
            callback();
        });
    });
};

/**
 * @param options {Object} Optional.
 *      - `log` {Bunyan Logger} Optional.
 * @param callback {Function}
 */
FlatFilesDatabase.prototype._save = function _save(options, callback) {
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.object(options, 'options');
    assert.optionalObject(options.log, 'options.log');
    assert.func(callback, 'callback');
    var self = this;
    var log = options.log || self.log;

    var serialized = {};
    Object.keys(self._repoFromName).forEach(function (n) {
        p('XXX ', n, self._repoFromName[n])
        serialized[n] = self._repoFromName[n].serialize();
    });
    var s = JSON.stringify(serialized, null, 2) + '\n';
    fs.writeFile(self._dbFile, s, function (err) {
        if (err) {
            callback(new errors.InternalError(err, 'error saving to database'));
        } else {
            callback();
        }
    });
};


FlatFilesDatabase.prototype.setup = function setup(callback) {
    var self = this;
    assert.func(callback, 'callback');
    async.series([
        function (next) {
            mkdirp(self.config.database.dir, next);
        },
        function (next) {
            self._load(next);
        }
    ], callback);
};


FlatFilesDatabase.prototype.addRepo = function addRepo(repoData, callback) {
    assert.string(repoData.name, 'repoData.name');
    assert.func(callback, 'callback');
    var repo = this._repoFromName[repoData.name] = createRepo(repoData);
    this._save(function (err) {
        if (err) {
            callback(err);
        } else {
            callback(null, repo);
        }
    });
};


FlatFilesDatabase.prototype.repoFromName = function repoFromName(name, callback) {
    callback(null, this._repoFromName[name]);
};

FlatFilesDatabase.prototype.listRepos = function listRepos(callback) {
    var keys = Object.keys(this._repoFromName);
    var repos = [];
    for (var i = 0; i < keys.length; i++) {
        repos.push(this._repoFromName[keys[i]]);
    }
    callback(null, repos);
};




//---- LevelDBDatabase
//TODO


//---- exports

var databaseClassFromType = {
    'flat-files': FlatFilesDatabase
};

function createDatabase(app, callback) {
    assert.object(app, 'app');
    assert.object(app.config, 'app.config');
    assert.object(app.config.database, 'app.config.database');
    var type = app.config.database.type;
    assert.ok(~Object.keys(databaseClassFromType).indexOf(type),
        'unexpected config.database.type: ' + type);
    assert.func(callback, 'callback');

    var db;
    try {
        db = new databaseClassFromType[type](app);
    } catch (e) {
        return callback(e);
    }
    app.log.info('setup db');
    db.setup(function (err) {
        app.log.info(err, 'db setup is complete: err=%s', err);
        callback(err, db);
    });
}

module.exports = {
    createDatabase: createDatabase
};
