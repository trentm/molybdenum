---
title: Hub API
brand: api.no.de
version: 1.0.0
---

# Hub API

### All API calls start with

<pre class="base">
{{ url }}/api
</pre>

### Format

All responses are **JSON** (that is, except for the current HTML docs that
you are reading).


<!--
    GET /api/repos/:repo
    GET /api/repos/:repo/tree/:branch/:path
    GET /api/repos/:repo/blob/:branch/:path
-->


# Repositories

## POST /push

Let the hub know about a new push to a repo. The request body must be a JSON
object of the following form (compatible with the Github URL post-receive
hook JSON format <http://help.github.com/post-receive-hooks/>):

    {
      "repository": {
        "url": $git_clone_url,
        "name": $name
      }
      "before": $before_sha,
      "after": $after_sha,
      "ref": $ref
    }

TODO: or should this be /repos/:repo/push. Or even just POST/PUT to /repos/:repo.


#### example request

    $ echo '{
        "repository": {
            "url": "git@code.example.com:cool-product.git",
            "name": "cool-product"
        },
        "before": "86fb0c2c2c37e71c218d386cc3f167496ce98c57",
        "after": "1a071c8728d57845ed76de67b8e0cbf2caa63915",
        "ref": "refs/heads/master"
    }' | curl {{ url }}/api/push -X POST -d @-

Note: This is pretty close to what you can use for a post-receive in your git
repo's ".git/hooks" dir.

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


## GET /repos

Return info on all current repositories in the hub.

#### example request

    $ curl {{ url }}/api/repos

#### example response

    {
      "repositories": [
        {
          "name": "eol",
          "url": "https://github.com/trentm/eol.git",
          "dir": "/data/hub/repos/eol.git",
          // Note: The following are internal. Will probably removed.
          "isCloned": true,
          "isFetchPending": false,
          "numActiveFetches": 0
        }
      ]
    }


## GET /repos/:repo

Return info on all current repositories in the hub.

#### example request

    $ curl {{ url }}/api/repos/eol

#### example response

    {
      "repository": {
        "name": "eol",
        "url": "https://github.com/trentm/eol.git",
        "dir": "/data/hub/repos/eol.git",
        // Note: The following are internal. Will probably removed.
        "isCloned": true,
        "isFetchPending": false,
        "numActiveFetches": 0
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


# General

## GET /

Return this HTML documentation or a JSON representation of the API, depending
on the request "Accept" header.

#### example JSON response

    {
      "endpoints": [
        "POST   /api/push"
      ], 
      "version": "1.0.0"
    }


