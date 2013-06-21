/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 *
 * The Molybdenum API endpoints.
 */

var p = console.log;
var format = require('util').format;

var assert = require('assert-plus');
var restify = require('restify');
var async = require('async');

var errors = require('./errors');




//---- endpoints

function apiListRepos(req, res, next) {
    res.send({});
    next();
}


//---- exports

function mountEndpoints(options) {
    assert.object(options, 'options');
    assert.object(options.app, 'options.app');
    assert.object(options.server, 'options.server');
    assert.func(options.reqAuth, 'options.reqAuth');
    assert.func(options.reqPassiveAuth, 'options.reqPassiveAuth');

    options.server.get({path: '/api/repos', name: 'ListRepos'},
        options.reqPassiveAuth, apiListRepos);
}


module.exports = {
    mountEndpoints: mountEndpoints
};
