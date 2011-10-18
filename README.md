# Molybdenum

A github tree viewer when you're repo isn't on Github (or even if it is).

This is a node.js server that provides a web-browsable view of your git
repos. Basically, you setup post-receive hooks for notifying Molybdenum
of your repo pushes and that's it.

Currently basic repo browsing (somewhat Github-esque) is supported.
Hopefully more features to come.


# post-receive hook

To tell a Molybdenum server about a push to your git repo, you'll want to add
something like this to your master git repo's "hooks/post-receive" file:

    MOLYBDENUM_CREDENTIALS=user:pass
    MOLYBDENUM_URL=https://molybdenum.example.com
    echo "Pinging Molybdenum at ${MOLYBDENUM_URL} about push."
    echo '{
        "repository": {
            "url": "git@code.example.com:cool-product.git",
            "name": "cool-product"
        }
    }' | curl --connect-timeout 2 -Ss -k -u "${MOLYBDENUM_CREDENTIALS}" \
        "${MOLYBDENUM_URL}/api/repos" -H "Content-Type: application/json" \
        -X POST -d @- >/dev/null || echo "Error telling Molybdenum. Continuing anyway."

Note: Be sure to make "hooks/post-receive" executable (commonly overlooked).

If your repo is on github (even if private), you can use something like the
following as a "Post-Receive URL" in "Service Hooks" panel of your repositories
admin pages:

    https://user:pass@molybdenum.example.com/api/repos

Obviously you need to adjust the URL and auth for whereever you are hosting
Molybdenum.


# Molybdenum post-fetch hooks

The "postFetchHooks" (global) config var is a comma-separate list of
post-fetch hooks. These are either a hook name (for built-in hooks that
ship with Molybdenum) or the full path to a separately installed post-fetch
hook. For example:

    postFetchHooks=jira,/home/mo/hooks/my-custom-post-fetch-hook

The built-in hooks are all at "tools/${NAME}-post-fetch-hook".

Each post-fetch hook is called for each branch/revision-range fetched
whenever a repo is updated. They are called with the same signature as
a regular git post-receive hook:

    .../foo-post-fetch-hook OLDREV NEWREV REFNAME

with the addition that the "MOLYBDENUM_CONFIG" and "CONFIG" envvars are
set to the full path to the Molybdenum ini config file. This allows a
post-fetch script to get configuration info. For example:

    CONFIG=/home/mo/config/molybdenum.ini \
        MOLYBDENUM_CONFIG=/home/mo/config/molybdenum.ini \
        /home/mo/hooks/my-custom-post-fetch-hook ea8d8c5 8d83628 refs/heads/master

By convention a post-fetch hook needing config info should use a
"[${name}PostFetchHook]" section in the ini file. E.g.:

    [myCustomPostFetchHook]
    foo=bar


## Jira built-in post-fetch hook

This is a post-fetch hook to add a comment describing a commit to a Jira
ticket if that ticket id (e.g. "PROJECTA-42") is mentioned in the commit
message.





