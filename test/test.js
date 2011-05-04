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


var testData = {
  "GET /api # HTML": function(test) {
    request({
          uri: 'http://localhost:3334/api',
          headers: {"Accept": "text/html"}
        }, function (error, response, body) {
      test.equal(response.statusCode, 200);
      //log(body)
      test.ok(body.indexOf("<html") != -1, "no <html")
      test.ok(body.indexOf("Hub API Documentation") != -1,
        "no 'Hub API Documentation'")
      test.done();
    });
  },
  "GET /api # JSON": function(test) {
    request({uri:'http://localhost:3334/api'}, function (error, response, body) {
      test.equal(response.statusCode, 200);
      var data = JSON.parse(body);
      test.ok(data.endpoints);
      test.ok(data.version);
      test.done();
    });
  },

  "GET /api/repos": function(test) {
    request({uri:'http://localhost:3334/api/repos'}, function (error, response, body) {
      test.equal(response.statusCode, 200);
      var data = JSON.parse(body);
      //log(body)
      test.ok(data.repositories);
      var eol = data.repositories.filter(function(r) { return r.name === "eol"; })[0];
      test.equal(eol.name, "eol");
      test.done();
    });
  },

  "GET /api/repos/:repo": function(test) {
    request({uri:'http://localhost:3334/api/repos/eol'}, function (error, response, body) {
      test.equal(response.statusCode, 200);
      //log(body)
      var data = JSON.parse(body);
      test.equal(data.repository.name, "eol");
      test.done();
    });
  },

  //"POST /api/repos/:repo": function(test) {
  //  //TODO
  //  test.done();
  //},

  "GET /api/repos/:repo/refs": function(test) {
    request({uri:'http://localhost:3334/api/repos/eol/refs'}, function (error, response, body) {
      test.equal(response.statusCode, 200);
      //log(body)
      var data = JSON.parse(body);
      test.ok(data.refs);
      test.ok(data.refs.indexOf("refs/heads/master") != -1);
      test.ok(data.refs.indexOf("refs/tags/0.7.5") != -1);
      test.done();
    });
  },
  
  // GET /api/repos/:repo/refs/:ref[/:path]
  "GET /api/repos/:repo/refs/:ref": function(test) {
    request({uri:'http://localhost:3334/api/repos/eol/refs/master'}, function (error, response, body) {
      test.equal(response.statusCode, 200);
      //log(body)
      var data = JSON.parse(body);
      test.equal(data.type, "tree");
      test.ok(data.tree);
      test.ok(data.tree.id);
      test.equal(data.tree.entries[0].name, ".gitignore");
      test.equal(data.ref, "refs/heads/master");
      test.equal(data.path, "");
      test.done();
    });
  },
  "GET /api/repos/:repo/refs/:ref  # tag": function(test) {
    request({uri:'http://localhost:3334/api/repos/eol/refs/0.7.2'}, function (error, response, body) {
      test.equal(response.statusCode, 200);
      //log(body)
      var data = JSON.parse(body);
      test.equal(data.type, "tree");
      test.ok(data.tree);
      test.ok(data.tree.id);
      test.equal(data.tree.entries[0].name, ".gitignore");
      test.equal(data.ref, "refs/tags/0.7.2");
      test.equal(data.path, "");
      test.done();
    });
  },

  //"GET /api/repos/:repo/refs/:ref/:path": function(test) {
  //  //TODO
  //  test.done();
  //}
};

if (process.env.TEST_ONLY !== undefined) {
  var re = new RegExp(process.env.TEST_ONLY);
  Object.keys(testData).map(function (key) {
    if (!re.test(key)) {
      delete testData[key];
    }
  });
}
exports['api'] = testCase(testData);
