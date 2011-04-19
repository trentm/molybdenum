
- layout API and url structure
    api/        # API docs
    
        POST /api/push
            Post a new repo push.
            TODO: get the info on what format a push post-receive hook from github looks like.
    
        GET  /api/repo
            List all repos.
        POST /api/repo
            Add a repo.
            This necessary? Perhaps all necessary details in the "POST /api/push".
        
    /
        Summary page of repos. Sort by most recently pushed? Stats on activity
        in those repos.
    /:repo/blob/:branch/:path   # rendered file page
    /:repo/raw/:branch/:path    # (??? whatever github URL is) raw file content page (mimetypes module?)
    
- "POST /api/push" handling:
    Just do a "git fetch"?
    TODO: Investigate node-git module, if any. Yes. Just calls git cmdln.
    http://help.github.com/post-receive-hooks/
        {
          "before": "5aef35982fb2d34e9d9d4502f6ede1072793222d",
          "repository": {
            "name": "foo",
            "url": "http://github.com/joe/foo"
          },
          "after": "de8251ff97ee194a289832576287d6f8ad74e3d0",
          "ref": "refs/heads/master"
        }  

    /api/push returns success right away if data looks good
    
- flow:
    setup db (read repo dirs)
    
    startup: queue up chaingang task to update each repo, then never lose anything on crash
        might be overkill with lots of repos. Could also have "POST /api/push" with empty
        "before/after" to force update of the repo.
    on queue of new 'fetch' task add to fifo of tasks for each repo
        completion of task removes from the fifo
        if the fifo has any items, then the repo is 'busy'
- read https://github.com/TooTallNate/node-gitProvider
    git@0.1.1                 =christkv latest remote stable   A node.js library for git    
    git-fs@0.0.6              =creationix latest remote   Git as a filesystem.    
        https://github.com/creationix/node-git
    gitteh@0.1.0              =samcday latest remote   Bindings to libgit2.     git, libgit2, bindi
        https://github.com/libgit2/node-gitteh
        XXX build failure on smartos (sigh)
        https://gist.github.com/e876cc3d9a6fb8156dca
    gitter@0.0.1              =sjs remote   GitHub client (API v2), inspired by pengwynn/octopussy 
    
- make gitteh build on solaris
- write the post-receive
- deploy to trentm.no.de
- add for eol.git and python-markdown2.git

