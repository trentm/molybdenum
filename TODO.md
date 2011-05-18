- move static stuff to "/static" prefix
- update docs (api doc, sitemap)
- write the post-receive
- deploy to head.no.de. Just json, eol, python-markdown2, restdown and a test repo.
- https for head.no.de
- GET /:repo/commit/:id
- GET /:repo/commits/:ref
- GET /:repo/blame/:ref/:path
- GET /:repo/commits/:ref/:path
- "POST /api/repos/:repo": Error if repo names don't match. Error if
  posting with a different repo url.
- 'hub' client?
- restify (not until regex routing)
- https://github.com/janl/mustache.js/issues/48
    sounds like a good fix to me, but it comes with a little nasty
    reshuffling of n in the textcase/examples. Anyone up for producing a full
    patch that makes all tests pass? I have a start at this in ~/tm/mustache.js.
  At the least, just pull in this mustache.js (easier).
- document the following in inline docs:
    startup: queue up chaingang task to update each repo, then never lose anything on crash
        might be overkill with lots of repos. Could also have "POST /api/push" with empty
        "before/after" to force update of the repo.
    on queue of new 'fetch' task add to fifo of tasks for each repo
        completion of task removes from the fifo
        if the fifo has any items, then the repo is 'busy'
- make gitteh build on solaris: https://github.com/libgit2/libgit2/pull/138
