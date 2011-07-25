# feature requests

- markdown rendering of .markdown|.md|.restdown et al files
- link a jira ticket name in commit message to the jira URL (i.e. autolinks)
- search by jira ticket name
- list of ocmmits (history)
- blame

# bugs

- josh: https://gq2ukvaa.joyent.us/cloud-api/blob/master/tools/watch-amqp.js
  and selected Branch: release-20110512
  returns a 404, should perhaps be a "file does not exist" (still a 404?)

# medium prio

- git bot ssh key (already have?)
- 'POST /api/repos' should bail if the url doesn't match existing
- redis caching of commit ids:  commit/$id (might be shortcut) = $reponame/$sha1
- button to add a repo on '/'
- "POST /api/repos/:repo": Error if repo names don't match. Error if
  posting with a different repo url.
- better name. bluelight? no reason. head? shed (little place with some tools)?
  molybdenum (element 42, "Mo" for short, "more" coloquial :)
- Verify this: make gitteh build on solaris:
  https://github.com/libgit2/libgit2/pull/138
- GET /:repo/commits?page=n
- reserved top-level names: commit, help, api, static, more?
- refactor stuff out of app.js!

# nice to haves

- commit/diff views: get more context, side-by-side diff?
- webrev-like support? i.e. upload a patch with good viewing tools for pre-commit code review.
  E.g. http://dev1.illumos.org/~eschrock/cr/zfs-refratio/
  'rm' likes webrev.
- /help/
- the POST to existing repo name with different data says 200 but does nothing (wrong)
- update docs (api doc, sitemap)
- error reporting for bogus repo:
    $ echo '{"repository": {"url": "git@github.com/trentm/eol.git", "name": "eol"}}' | curl http://localhost:3333/api/repos/eol -X POST -d @-
  led to this in the log:
    gitExec: code 128: git clone --bare git@github.com/trentm/eol.git /Users/trentm/tm/hub2/tmp/data/tmp/eol.52297
    error: Error cloning repository 'eol' (git@github.com/trentm/eol.git) to '/Users/trentm/tm/hub2/tmp/data/tmp/eol.52297': Error: fatal: Could not switch to 'git@github.com/trentm': No such file or directory
- redis caching for syntaxHighlight
  http://0.0.0.0:3333/illumos-live/blob/master/usr/src/lib/libzonecfg/common/libzonecfg.c
- cli client
- document the following in inline docs:
    startup: queue up chaingang task to update each repo, then never lose anything on crash
        might be overkill with lots of repos. Could also have "POST /api/push" with empty
        "before/after" to force update of the repo.
    on queue of new 'fetch' task add to fifo of tasks for each repo
        completion of task removes from the fifo
        if the fifo has any items, then the repo is 'busy'
- GET /:repo/blame/:ref/:path
- GET /:repo/commits/:ref/:path
- restify
- https://github.com/janl/mustache.js/issues/48
    sounds like a good fix to me, but it comes with a little nasty
    reshuffling of n in the textcase/examples. Anyone up for producing a full
    patch that makes all tests pass? I have a start at this in ~/tm/mustache.js.
  I've the patched mustache.js locally, but would be good to get it into
  the core.
