- syntax coloring:
    - http://0.0.0.0:3333/eol/commit/1a071c8728d57845ed76de67b8e0cbf2caa63915
        Get that to have the styling, line numbering and anchor highlighting support
        of, e.g. http://0.0.0.0:3333/eol/blob/master/Makefile.py
    - make a partial out of this
    - get this in blob views
- redis caching for syntaxHighlight
  http://0.0.0.0:3333/illumos-live/blob/master/usr/src/lib/libzonecfg/common/libzonecfg.c
- node_modules cleanup: thsoe that can be should be install via
  'npm install'. The others manually first handled by having them
  commited.
- GET /commit/:id   # redirs to appropriate repo -> cache in redis
- GET /:repo/commits?page=n
- move static stuff to "/static" prefix: Done, but need to fix css link in restdown docs.
- update docs (api doc, sitemap)
- write the post-receive
- deploy to head.no.de. Just json, eol, python-markdown2, restdown and a test repo.
- https for head.no.de
- "POST /api/repos/:repo": Error if repo names don't match. Error if
  posting with a different repo url.
- better name. bluelight? no reason. head?
- 'hub' client?
- Verify this: make gitteh build on solaris:
  https://github.com/libgit2/libgit2/pull/138


# nice to haves

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
