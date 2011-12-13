/* Copyright 2011 (c) Trent Mick.
 *
 * This contains a number of auth backends and a single `createAuth` method
 * to create one from a given config.
 * 
 * An auth backend implements:
 *  function authenticate(username, password, function(err, user))
 *  function getUser(uuidOrUsername, function(err, user))
 */

var fs = require('fs');
var assert = require('assert');
var debug = console.warn;
var log4js = require('log4js');


var log = log4js.getLogger("auth");
log.setLevel("INFO");



//---- "ldap" auth backend

function LdapAuthBackend(config) {
  this._config = config;
  
  assert.ok(config.authLdapUrl, "no 'authLdapUrl' in config");
  assert.ok(config.authLdapAdminDn, "no 'authLdapAdminDn' in config");
  assert.ok(config.authLdapAdminPassword, "no 'authLdapAdminPassword' in config");
  assert.ok(config.authLdapSearchBase, "no 'authLdapSearchBase' in config")
  assert.ok(config.authLdapSearchFilter, "no 'authLdapSearchFilter' in config");
  
  
  var LdapAuth = require('ldapauth');
  this._auth = new LdapAuth({
    url: config.authLdapUrl,
    adminDn: config.authLdapAdminDn,
    adminPassword: config.authLdapAdminPassword,
    searchBase: config.authLdapSearchBase,
    searchFilter: config.authLdapSearchFilter,
    //log4js: require('log4js'),
    cache: true
  });

  this._usernameField = config.authLdapUsernameField;

  //// TODO:XXX `.close()` the LdapAuth.
  //process.on("exit", function () {
  //  auth.close(function (err) {
  //    if (err) {
  //      log("Error closing LDAP auth: %s", err);
  //    }
  //  });
  //});
}

LdapAuthBackend.prototype.authenticate = function (username, password, callback) {
  var self = this;
  this._auth.authenticate(username, password, function (err, user) {
    if (self._usernameField && self._usernameField !== "login") {
      user.login = user[self._usernameField];
    }
    callback(err, user);
  });
}

LdapAuthBackend.prototype.getUser = function (uuidOrUsername, callback) {
  throw new Error("Not yet implemented: <LdapAuthBackend>.getUser");
}



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
}

SdcCapiAuthBackend.prototype.authenticate = function (username, password, callback) {
  this.CAPI.authenticate(username, password, function (err, customer) {
    if (err) {
      log("CAPI auth error: %s", err);
    }
    if (customer) {
      //log("Authenticated user '%s'.", customer.login);
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
  var rawUsers = JSON.parse(fs.readFileSync(config.authStaticFile, 'utf-8'));
  rawUsers.forEach(function (user) {
    assert.ok(user.login);
    assert.ok(user.uuid);
    this_.userFromLogin[user.login] = user;
    this_.userFromUuid[user.uuid] = user;
  });
}

StaticAuthBackend.prototype.authenticate = function (username, password, callback) {
  user = this.userFromLogin[username];
  if (!user || password != user.password) {
    callback({"message": "Unauthorized"});
  } else {
    //log("Authenticated user '%s'.", user.login);
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



//---- exported methods

// Auth backend registry.
registry = {
  "ldap": LdapAuthBackend,
  "sdccapi": SdcCapiAuthBackend,
  "static": StaticAuthBackend
}

/**
 * Return an auth object for the given config.
 *
 * @param config {Object} The loaded server config object.
 */
function createAuth(config) {
  if (!config) throw new TypeError("'config' is required");
  return new registry[config.authMethod](config);
}



exports.createAuth = createAuth;
