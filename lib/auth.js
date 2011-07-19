/* Copyright 2011 (c) Trent Mick.
 *
 * Hub auth.
 *
 * This contains a number of auth backends and a single `createAuth` method
 * to create one from a given config.
 *
 * 
 * An auth backend implements:
 *  function authenticate(username, password, function(err, user))
 *  function getUser(uuidOrUsername, function(err, user))
 */

var assert = require('assert');

var log = console.log;
var warn = console.warn;



//---- "sdccapi" auth backend

/**
 * Create an "sdccapi" auth backend.
 */
function SdcCapiAuthBackend(config) {
  this._config = config;
  assert.ok(config.authSdcCapiClientUrl)
  assert.ok(config.authSdcCapiClientUser)
  assert.ok(config.authSdcCapiClientPassword)
  
  var sdcClients = require('sdc-clients');
  //clients.setLogLevel("trace");

  this.CAPI = new sdcClients.CAPI({
    url: config.authSdcCapiClientUrl,
    username: config.authSdcCapiClientUser,
    password: config.authSdcCapiClientPassword
  });
  //log("XXX CAPI is", this.CAPI)
  
}

SdcCapiAuthBackend.prototype.authenticate = function (username, password, callback) {
  this.CAPI.authenticate(username, password, function (err, customer) {
    if (err) {
      log("CAPI auth error: %s", err);
    }
    if (customer) {
      log("Authenticated user '%s'.", customer.login);
      customer.isAdmin = (customer.role == 2); // CAPI-ism
    }
    callback(err, customer)
  });
}

SdcCapiAuthBackend.prototype.getUser = function (uuidOrUsername, callback) {
  this.CAPI.getAccount(uuidOrUsername, callback);
}



//---- "static" auth backend

function StaticAuthBackend(config) {
  this._config = config;
  assert.ok(config.authStaticFile);

  this.userFromLogin = {};  // login -> user-info
  this.userFromUuid = {};  // uuid -> user-info


  var this_ = this;
  var path = absPath(config.authStaticFile, config.dir);
  var rawUsers = JSON.parse(fs.readFileSync(path, 'utf-8'));
  rawUsers.forEach(function (user) {
    assert.ok(user.login);
    assert.ok(user.uuid);
    assert.ok(user.isAdmin !== undefined);
    this_.userFromLogin[user.login] = user;
    this_.userFromUuid[user.uuid] = user;
  });
}

StaticAuthBackend.prototype.authenticate = function (username, password, callback) {
  user = this.userFromLogin[username];
  if (!user || password != user.password) {
    callback({"message": "Unauthorized"});
  } else {
    log("Authenticated user '%s'.", user.login);
    callback(null, {
      login: user.login,
      uuid: user.uuid,
      isAdmin: user.isAdmin
    });
  }
}

StaticAuthBackend.prototype.getUser = function (uuidOrUsername, callback) {
  if (this.userFromUuid.hasOwnProperty(uuidOrUsername)) {
    callback(null, this.userFromUuid[uuidOrUsername]);
  } else if (this.userFromLogin.hasOwnProperty(uuidOrUsername)) {
    callback(null, this.userFromLogin[uuidOrUsername]);
  } else {
    callback({"message": "No such user: '"+uuidOrUsername+"'"})
  }
}



//---- "public" auth backend

function PublicAuthBackend(config) {
  this.anonymousUser = (config.authPublicAnonymousUser
    ? JSON.parse(config.authPublicAnonymousUser)
    : null);
}

PublicAuthBackend.prototype.authenticate = function (username, password, callback) {
  log("XXX PublicAuthBackend.authenticate:", username, password, callback)
  callback(null, this.anonymousUser);
}

// TODO: Not totally sure about the behaviour here. Does it matter?
PublicAuthBackend.prototype.getUser = function (uuidOrUsername, callback) {
  log("XXX PublicAuthBackend.getUser")
  if (!this.anonymousUser) {
    callback(null, null);
  } else if (this.anonymousUser
             && (this.anonymousUser.uuid === uuidOrUsername
                 || this.anonymousUser.login === uuidOrUsername)) {
    callback(null, this.anonymousUser);
  } else {
    callback({"message": "No such user: '"+uuidOrUsername+"'"})
  }
}



//---- exported methods

// Auth backend registry.
registry = {
  "sdccapi": SdcCapiAuthBackend,
  "static": StaticAuthBackend,
  "public": PublicAuthBackend
}

/**
 * Return an auth object for the given config.
 *
 * @param config {Object} The loaded hub config object.
 */
function createAuth(config) {
  if (!config) throw new TypeError("'config' is required");
  return new registry[config.authMethod](config);
}



exports.createAuth = createAuth;
