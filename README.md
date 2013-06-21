
# dir layout

    bin/
        molybdenumd             # molybdenum daemon
        mo
    etc/
        molybdenum.config.json
    lib/


# TODO

- clean up docs, update current config info
- log.info the config with imgapi/amon-master masking of passwords
- commit to branch
...
- full mo api
- redis for caching, faster /commit/:sha redir
- reliable git lib
- tagging of repos
- commits page: per repo, per tag, all
- RFE from josh: mo tool and link on each file page on a branch to that
  file locked to the current sha (so it doesn't change as the branch
  changes).
