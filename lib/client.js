/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 *
 * A Molybdenum client:
 *
 *      var molybdenum = require('molybdenum');
 *      var client = molybdenum.createClient({url: <URL>});
 *      client.ping(function (err, pong, res) { ... });
 */

var p = console.log;
var format = require('util').format;
var qs = require('querystring');

var assert = require('assert-plus');
var restify = require('restify');
var async = require('async');

var errors = require('./errors');



//---- client

/**
 * Molybdenum client class.
 *
 * @param options {Object}
 *      - `url` {String} IMGAPI url
 *      - `user` {String} Optional. Used for basic or http-signature auth.
 *      - `password` {String} Optional. If provided, this implies that basic
 *        auth should be used for client requests.
 *      - `log` {Bunyan Logger} Optional.
 */
function MolybdenumClient(options) {
    assert.object(options, 'options');
    assert.string(options.url, 'options.url');
    assert.optionalString(options.user, 'options.user');
    assert.optionalString(options.password, 'options.password');
    assert.optionalObject(options.log, 'options.log');

    this.client = restify.createJsonClient(options);
}

MolybdenumClient.prototype._getAuthHeaders = function _getAuthHeaders(callback) {
    callback(null, {});
};

/**
 * Ping.
 *
 * @param error {String} Optional error code. If given, the ping is expected
 *      to respond with a sample error with that code (if supported).
 * @param callback {Function} `function (err, pong, res)`
 */
MolybdenumClient.prototype.ping = function ping(error, callback) {
    var self = this;
    if (typeof (error) === 'function') {
        callback = error;
        error = undefined;
    }
    assert.optionalString(error, 'error');
    assert.func(callback, 'callback');

    var path = '/ping';
    if (error) {
        path += '?' + qs.stringify({error: error});
    }
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        var opts = {
            path: path,
            headers: headers,
            connectTimeout: 15000 // long default for spotty internet
        };
        self.client.get(opts, function (err, req, res, pong) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, pong, res);
            }
        });
    });
};



//---- exports

function createClient(options) {
    return new MolybdenumClient(options);
}

module.exports = {
    createClient: createClient
};
