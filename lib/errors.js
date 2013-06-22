/*
 * Copyright (c) 2013 Trent Mick. All rights reserved.
 * Copyright (c) 2013 Joyent, Inc. All rights reserved.
 *
 * Molybdenum errors. Error responses follow
 * <https://mo.joyent.com/docs/eng/master/#error-handling>
 *
 * Test out an example errors response via:
 *
 *      curl -i MO-SERVER/ping?error=InternalError
 */

var util = require('util'),
    format = util.format;
var restify = require('restify'),
    RestError = restify.RestError;
var assert = require('assert-plus');


//---- globals

var samples = {};


//---- Errors

/**
 * Usage:
 *      new ValidationFailedError("boom", errors)
 *      new ValidationFailedError(cause, "boom", errors)
 * I.e. optional *first* arg "cause", per WError style.
 */
function ValidationFailedError(cause, message, errors) {
    if (errors === undefined) {
        errors = message;
        message = cause;
        cause = undefined;
    }
    assert.string(message, 'message');
    assert.arrayOfObject(errors, 'errors');
    RestError.call(this, {
        restCode: this.constructor.restCode,
        statusCode: this.constructor.statusCode,
        message: message,
        cause: cause,
        body: {
            code: this.constructor.restCode,
            message: message,
            errors: errors
        }
    });
}
util.inherits(ValidationFailedError, RestError);
ValidationFailedError.prototype.name = 'ValidationFailedError';
ValidationFailedError.restCode = 'ValidationFailed';
ValidationFailedError.statusCode = 422;
ValidationFailedError.description = 'Validation of parameters failed.';
samples.ValidationFailedError = new ValidationFailedError('sample validation failure', []);


function InvalidParameterError(cause, message, errors) {
    if (errors === undefined) {
        errors = message;
        message = cause;
        cause = undefined;
    }
    assert.string(message, 'message');
    assert.arrayOfObject(errors, 'errors');
    RestError.call(this, {
        restCode: this.constructor.restCode,
        statusCode: this.constructor.statusCode,
        message: message,
        cause: cause,
        body: {
            code: this.constructor.restCode,
            message: message,
            errors: errors
        }
    });
}
util.inherits(InvalidParameterError, RestError);
InvalidParameterError.prototype.name = 'InvalidParameterError';
InvalidParameterError.restCode = 'InvalidParameter';
InvalidParameterError.statusCode = 422;
InvalidParameterError.description = 'Given parameter was invalid.';
samples.InvalidParameterError = new InvalidParameterError(
    'invalid "foo"', [ {field: 'foo', code: 'Invalid'} ]);


function ConfigFileDoesNotExitError(cause, configPath) {
    if (configPath === undefined) {
        configPath = cause;
        cause = undefined;
    }
    assert.optionalObject(cause, 'cause');
    assert.string(configPath, 'configPath');
    var message = format('config file "%s" does not exist', configPath)
    RestError.call(this, {
        restCode: this.constructor.restCode,
        statusCode: this.constructor.statusCode,
        message: message,
        cause: cause
    });
}
util.inherits(ConfigFileDoesNotExitError, RestError);
ConfigFileDoesNotExitError.prototype.name = 'ConfigFileDoesNotExist';
ConfigFileDoesNotExitError.restCode = 'ConfigFileDoesNotExitError';
ConfigFileDoesNotExitError.statusCode = 409;
ConfigFileDoesNotExitError.description =
    'The given config file path does not exist';
samples.ConfigFileDoesNotExitError = new ConfigFileDoesNotExitError('/tmp/foo.json');


samples.InternalError = new restify.InternalError('sample internal error');



//---- exports

module.exports = {
    ValidationFailedError: ValidationFailedError,
    InvalidParameterError: InvalidParameterError,
    ConfigFileDoesNotExitError: ConfigFileDoesNotExitError,

    // Core restify RestError and HttpError classes used by IMGAPI.
    InternalError: restify.InternalError,
    ResourceNotFoundError: restify.ResourceNotFoundError,
    InvalidHeaderError: restify.InvalidHeaderError,
    ServiceUnavailableError: restify.ServiceUnavailableError,
    UnauthorizedError: restify.UnauthorizedError,
    BadRequestError: restify.BadRequestError,

    samples: samples
};



//---- mainline (to print out errors table for the docs)

// Some error table data that isn't included on the error classes above.
var descFromError = {
    InvalidHeaderError: 'An invalid header was given in the request.'
};

function generateRestdownTable(errors) {
    var http = require('http');
    var rows = ['||**Code**||**HTTP status code**||**Description**||'];
    Object.keys(errors).forEach(function (name) {
        var E = errors[name];
        var restCode, statusCode;
        if (!E.restCode) {
            var e = new E();
            restCode = e.restCode || e.body.code;
            statusCode = e.statusCode;
        } else {
            restCode = E.restCode;
            statusCode = E.statusCode;
        }
        var desc = E.description;
        if (!desc) {
            desc = descFromError[name];
        }
        if (!desc) {
            desc = http.STATUS_CODES[statusCode];
        }
        rows.push(format('||%s||%s||%s||', restCode, statusCode, desc));
    });
    return rows.join('\n');
}

if (require.main === module) {
    var p = console.log;
    var errs = {};
    Object.keys(module.exports).forEach(function (e) {
        if (/Error$/.test(e)) {
            errs[e] = module.exports[e];
        }
    });
    var table = generateRestdownTable(errs);
    p(table);
}
