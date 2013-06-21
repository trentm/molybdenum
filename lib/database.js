/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 *
 * Molybdenum database.
 */

var format = require('util').format;
var assert = require('assert-plus');
var mkdirp = require('mkdirp');


//---- internal stuff


//---- Database base class


function Database(app) {
}

Database.prototype.setup = function setup(callback) {
    assert.func(callback, 'callback');
    callback();
};


//---- FlatFilesDatabase

function FlatFilesDatabase(app) {
    this.config = app.config;
    assert.object(this.config, 'config');
    assert.equal(this.config.database.type, 'flat-files');
    assert.string(this.config.database.dir, 'config.database.dir');
}

FlatFilesDatabase.prototype.setup = function setup(callback) {
    assert.func(callback, 'callback');
    mkdirp(this.config.database.dir, callback);
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
    db.setup(function (err) {
        app.log.info(err, 'db setup is complete: err=%s', err);
        callback(err, db);
    });
}

module.exports = {
    createDatabase: createDatabase
};
