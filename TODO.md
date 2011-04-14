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
            "url": "http://github.com/defunkt/github",
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
    
    
    
- define usage
- write the post-receive
- deploy to trentm.no.de
- add for eol.git and python-markdown2.git

