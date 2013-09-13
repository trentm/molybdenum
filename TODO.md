# feature requests

- josh: list of ocmmits (history)
    - title h3 for commits page
    - pill nav for all pages? "sources commits ..." along with menulist
    - document and test api endpoint
    - add paging to api endpoint
    - drop viewAddCommit -> viewCommitFromMoCommit
- josh: list of commits for *all* repos (TOOLS-25?)
    GET /api/repos/:repo/commits/:branch
    GET /api/commit/:id
    GET /commit/:id
    New:
        GET /api/commits/:branch
        GET /commits/:branch
- markc: markdown rendering of .markdown|.md|.restdown et al files
- link a jira ticket name in commit message to the jira URL (i.e. autolinks)
- search by jira ticket name
- markc: blame
- rm: opengrok integration.
  Or consider cscope (http://cscope.sourceforge.net/), "since cscope kind of
  understands JS and C, I wonder how bad it would be to read it's binary
  database format."
- rm, josh: Some way to get emails (digests, possibly) for recent/daily commits.
  Featuritis danger here.
- andres,trent: gist-like functionality
- stu: a list of contained branches on a commit would be very nice
- better molybdenum /api/repos/:repo/commits/:ref  API for John
  Basically want to do equiv of `git log fa5ec06..HEAD` on a particular branch,
  where "fa5ec06" is the SHA from a previous release so can get a list of
  changes for this new release.

    https://github.com/trentm/restdown/compare/60cda26242ac...master

# high prio


- no cache headers on content. E.g. all images/css/js pulled everytime!
  Or is that just express dev mode?


# bugs

- "branch" for a commit is bogus, e.g.:
   https://mo.joyent.com/mcp_api_admin/commit/97bdd549800b1433a8919a5fb79a1603cf9778b0
- trentm: https://mo.joyent.com/operator-toolkit/blob/master/bin/sdc-dsimport#L136-137
  Bugs in leading whitespace in there. Syntax coloring bug?
- wdp: the "brief" commit message isn't always all that is wanted (for those
  that don't stick to one line fo the summary)
  idea: Perhaps add a "more...". Could be a link to drop down the whole
  message. Or, if common enough could take first *two* lines? Raises minimum
  box height.
- trentm: https://mo.joyent.com/agents/commit/7ce20d24794f32303891908db0311f9b58ee8bf2
  That diff is 25k lines! and blows Mo's mind. Guard on num lines (or time?)
  for lexing. Or is the prob rendering on the client side? Anyway, want a
  low-res fallback.
- josh: https://gq2ukvaa.joyent.us/cloud-api/blob/master/tools/watch-amqp.js
  and selected Branch: release-20110512
  returns a 404, should perhaps be a "file does not exist" (still a 404?)
- ':' in password is a problem:
    https://github.com/senchalabs/connect/pull/331
  Upgrade Connect (to 1.6.1?) when that is ready... and I guess push for an
  express upgrade when that is released.

# medium prio

- JEG `make check`
- redis caching of commit ids:  commit/$id (might be shortcut) = $reponame/$sha1
- button to add a repo on '/'
- "POST /api/repos/:repo": Error if repo names don't match. Error if
  posting with a different repo url.
- GET /:repo/commits?page=n
- reserved top-level names: commit, help, api, static, more?
- refactor stuff out of app.js!
- back to 'spartan' restdown brand: need to fix the spartan TOC to not overflow
  perhaps by just naming api endpoints. Then readd this:

      brand: spartan
      logo-color: purple
      logo-font-family: google:Droid Sans, Verdana, sans-serif
      header-font-family: google:Droid Sans, Verdana, sans-serif


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
