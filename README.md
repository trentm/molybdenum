# Molybdenum

A github tree viewer when you're repo isn't on Github (or even if it is).

This is a node.js server that provides a web-browsable view of your git
repos. Basically, you setup post-receive hooks for notifying Molybdenum
of your repo pushes and that's it.

Currently basic repo browsing (somewhat Github-esque) is supported.
Hopefully more features to come.


## post-receive hook

To tell a Molybdenum server about a push to your git repo, you'll want to add
something like this to your master git repo's "hooks/post-receive" file:

    MOLYBDENUM_CREDENTIALS=user:pass
    MOLYBDENUM_URL=https://molybdenum.example.com
    echo "Ping Molybdenum at ${MOLYBDENUM_URL} about push."
    echo '{
        "repository": {
            "url": "git@code.example.com:cool-product.git",
            "name": "cool-product"
        }
    }' | curl --connect-timeout 2 -Ss -k -u "${MOLYBDENUM_CREDENTIALS}" "${MOLYBDENUM_URL}/api/repos" -H "Content-Type: application/json" -X POST -d @- >/dev/null || echo "Error telling Molybdenum. Continuing anyway."

Note: Be sure to make "hooks/post-receive" executable (commonly overlooked).

If your repo is on github (even if private), you can use something like the
following as a "Post-Receive URL" in "Service Hooks" panel of your repositories
admin pages:

    https://user:pass@molybdenum.example.com/api/repos

Obviously you need to adjust the URL and auth for whereever you are hosting
Molybdenum.
