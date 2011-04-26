/* 'hub' test suite
 *
 * Usage:
 *      nodeunit test.js
 */

var path = require('path');
var sys  = require('sys');
var exec = require('child_process').exec;
var fs   = require('fs');
var testCase = require('nodeunit').testCase;
var request = require('request');
var log = console.warn;



_setUpFirst = false;
function setUpFirst(callback) {
  if (_setUpFirst) {
    callback();
    return;
  } else {
    _setUpFirst = true;
  }
  request({
      uri: 'http://localhost:3334/api/repos',
      method: 'POST'
    }, function (error, response, body) {
      callback();
  });
}


var data = {
  //setUp: function(callback) {
  //  setUpFirst(callback);
  //},

  testRepos: function(test) {
    request({uri:'http://localhost:3334/api/repos'}, function (error, response, body) {
      test.equal(response.statusCode, 200);
      var data = JSON.parse(body);
      //log(body) //XXX
      test.ok(data.repositories);
      var eol = data.repositories.filter(function(r) { return r.name === "eol"; })[0];
      test.equal(eol.name, "eol");
      test.done();
    });
  },
  testRepo: function(test) {
    test.done();
  }
};

exports['test'] = testCase(data);
