
# dir layout

    bin/
        molybdenumd.js              # molybdenum server
        mo                          # molybdenum cli
    etc/
        molybdenum.config.json
    lib/


# TODO

- FetchRepo
- fill in Site Map in docs
- add plan for versions/commit-range endpoints, changelog endpoints
...
- full mo api
- redis for caching, faster /commit/:sha redir
- reliable git lib
- tagging of repos
- commits page: per repo, per tag, all
- RFE from josh: mo tool and link on each file page on a branch to that
  file locked to the current sha (so it doesn't change as the branch
  changes).
