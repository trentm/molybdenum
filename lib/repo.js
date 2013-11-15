/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 *
 * Molybdenum `Repo` class.
 */

var format = require('util').format;
var assert = require('assert-plus');



/**
 * Repo constructor
 *
 * @params raw {Object} Raw data.
 */
function Repo(raw) {
    assert.string(raw.name, 'raw.name');
    assert.string(raw.url, 'raw.url');
    this.name = raw.name;
    this.url = raw.url;
}

Repo.prototype.serialize = function serialize() {
    return {
        name: this.name,
        url: this.url
    };
};


module.exports = Repo;
module.exports.createRepo = function createRepo(raw) {
    return new Repo(raw);
}
