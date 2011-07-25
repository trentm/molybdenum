---
title: Molybdenum API
---

# Molybdenum API and Sitemap

### All API calls start with

<pre class="base">
{{ url }}/api
</pre>

### Format

All responses are **JSON** (that is, except for the current HTML docs that
you are reading).


<!--
    # JSON
    GET /api/repos
    GET /api/repos/:repo
    DELETE /api/repos/:repo
    GET /api/repos/:repo/refs
    GET /api/repos/:repo/refs/:ref/:path
        GET /api/repos/eol/ref/master/README.md
        {
            "ref": "refs/heads/master",
            "path": "README.md",
            "type": "blob",
            "blob" {
                "id": ...
                "data": ...
            }
        }
        ...OR...
        GET /api/repos/eol/refs/master/lib
        {
            "ref": "refs/heads/master",
            "path": "lib",
            "type": "tree",
            "tree": {
              "id": "0bbd683f331433c826bdcfbc31014c1f65713348",
              "entries":
                 [ { id: 'ae2e0f752a4d4363e33f92caacf7bae0042f587e',
                     name: 'eol.py',
                     attributes: 33261 } ]
            }
        }
        GET /api/commit/:id
        {
          "commit": {
            "id": "50c3c7295d473e42adaf14f4e6f12df5c18a6e01",
            "message": "slight adding to Tim's test case for html5 block tags\n",
            "author": {
              "name": "Trent Mick",
              "email": "trentm@gmail.com",
              "time": "2011-03-23T04:48:40.000Z",
              "timeOffset": -420
            },
            "committer": {
              "name": "Trent Mick",
              "email": "trentm@gmail.com",
              "time": "2011-03-23T04:48:40.000Z",
              "timeOffset": -420
            },
            "parents": [
              "b72fee60f3c25e70d349567578f01011c450b5a5"
            ],
            "tree": "16c95e7f8d2006871c34d9e8e716b4d0048eb165"
          },
          "repository": {
            "name": "markdown2",
            "url": "git@github.com:trentm/python-markdown2.git",
            "isCloned": true,
            "isFetchPending": false
          }
        }

    # HTML
    GET /:repo
    GET /:repo/tree/:ref/:path
    GET /:repo/blob/:ref/:path
    GET /:repo/raw/:ref/:path
    GET /:repo/commit/:id
    GET /:repo/commits/:ref
    

-->


# General API

## GET /api

Return this HTML documentation or a JSON representation of the API, depending
on the request "Accept" header.

#### example JSON response

    {
      "endpoints": [
        ...
      ], 
      "version": "1.0.0"
    }




# Repository API

## GET /api/repos

List all repositories currently in the molybdenum server. (TODO: add paging)

#### example request

    $ curl {{ url }}/api/repos

#### example response

    {
      "repositories": [
        {
          "name": "eol",
          "url": "https://github.com/trentm/eol.git",
          "dir": "/data/molybdenum/repos/eol.git",
          // Note: The following are internal. Will probably be removed.
          "isCloned": true,
          "isFetchPending": false,
          "numActiveFetches": 0,
          ...
        }
      ]
    }


## POST /api/repos

Let the server know about a new push to a repo. The request body must be a JSON
object of the following form (compatible with the Github URL post-receive
hook JSON format <http://help.github.com/post-receive-hooks/>):

    {
      "repository": {
        "url": $git_clone_url,
        "name": $name
      },
      // These are optional:
      "before": $before_sha,
      "after": $after_sha,
      "ref": $ref
    }

At a minimum, only the "repository" key is required.


#### example request

    $ echo '{
        "repository": {
            "url": "git@code.example.com:cool-product.git",
            "name": "cool-product"
        },
        "before": "86fb0c2c2c37e71c218d386cc3f167496ce98c57",
        "after": "1a071c8728d57845ed76de67b8e0cbf2caa63915",
        "ref": "refs/heads/master"
    }' | curl {{ url }}/api/repos -X POST -H "Content-Type: application/json" -d @-

TODO: add example post-receive hook script and post-receive webhook URL.

#### successful response

    ...
    Status: 200

    {
      "success": true
    }

#### error response

    ...
    Status: 400

    {
      "success": true,
      "error": "some description of the error"
    }

## GET /api/repos/:repo

Return info on all current repositories in the molybdenum server.

#### example request

    $ curl {{ url }}/api/repos/eol

#### example response

    {
      "repository": {
        "name": "eol",
        "url": "https://github.com/trentm/eol.git",
        "dir": "/data/molybdenum/repos/eol.git",
        ...
      }
    }

#### failure response

    ...
    Status: 404

    {
      "error": {
        "message": "no such repo: 'asdf'",
        "code": 404
      }
    }


## GET /api/repos/:repo


## DELETE /api/repos/:repo


## GET /api/repos/:repo/refs


## GET /api/repos/:repo/refs/:ref/:path

    GET /api/repos/eol/ref/master/README.md
    {
        "ref": "refs/heads/master",
        "path": "README.md",
        "type": "blob",
        "blob" {
            "id": ...
            "data": ...
        }
    }
    ...OR...
    GET /api/repos/eol/refs/master/lib
    {
        "ref": "refs/heads/master",
        "path": "lib",
        "type": "tree",
        "tree": {
          "id": "0bbd683f331433c826bdcfbc31014c1f65713348",
          "entries":
             [ { id: 'ae2e0f752a4d4363e33f92caacf7bae0042f587e',
                 name: 'eol.py',
                 attributes: 33261 } ]
        }
    }



## GET /api/commit/:id
    
    {
      "commit": {
        "id": "50c3c7295d473e42adaf14f4e6f12df5c18a6e01",
        "message": "slight adding to Tim's test case for html5 block tags\n",
        "author": {
          "name": "Trent Mick",
          "email": "trentm@gmail.com",
          "time": "2011-03-23T04:48:40.000Z",
          "timeOffset": -420
        },
        "committer": {
          "name": "Trent Mick",
          "email": "trentm@gmail.com",
          "time": "2011-03-23T04:48:40.000Z",
          "timeOffset": -420
        },
        "parents": [
          "b72fee60f3c25e70d349567578f01011c450b5a5"
        ],
        "tree": "16c95e7f8d2006871c34d9e8e716b4d0048eb165"
      },
      "repository": {
        "name": "markdown2",
        "url": "git@github.com:trentm/python-markdown2.git",
        "isCloned": true,
        "isFetchPending": false
      }
    }


# Sitemap

TODO:...
