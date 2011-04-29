- mustache templating: "GET /" as guinea pig
- 'hub' client?
- "POST /api/repos/:repo": Error if repo names don't match. Error if
  posting with a different repo url.
- restify (not until regex routing)
- write the post-receive
- deploy to joyent.no.de. Just json, eol, python-markdown2, restdown and a test repo.
- https for joyent.no.de
- document the following in inline docs:
    startup: queue up chaingang task to update each repo, then never lose anything on crash
        might be overkill with lots of repos. Could also have "POST /api/push" with empty
        "before/after" to force update of the repo.
    on queue of new 'fetch' task add to fifo of tasks for each repo
        completion of task removes from the fifo
        if the fifo has any items, then the repo is 'busy'
- make gitteh build on solaris: https://github.com/libgit2/libgit2/pull/138

