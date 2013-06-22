/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 */

module.exports = {
    createClient: function createClient(options) {
        var client = require('./client');
        return client.createClient(options);
    }
};
