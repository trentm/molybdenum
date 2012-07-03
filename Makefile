#
# Copyright (c) 2012 Trent Mick, Joyent Inc. All rights reserved.
#
# molybdenum makefile, based on the Joyent Engineering Guidelines makefiles.
#


DOC_FILES 		 = index.restdown
JS_FILES 		:= $(shell find lib -name "*.js") app.js
JSL_CONF_NODE    = tools/jsl.node.conf
JSL_FILES_NODE   = server.js $(JS_FILES)
JSSTYLE_FILES    = server.js $(JS_FILES)
JSSTYLE_FLAGS    = -o indent=4,doxygen,unparenthesized-return=0


include ./tools/mk/Makefile.defs


#
# Targets
#

all: deps

# Using 'express' as the landmark for all node deps in package.json.
.PHONY: deps
deps: node_modules/express

node_modules/express:
	$(NPM) install

.PHONY: devrun
devrun:  
	mkdir -p tmp
	@if [ ! -f dev.json ]; then \
	    echo "error: 'dev.json' does not exist."; \
	    echo " - Create it: 'cp tools/dev.json.in dev.json'"; \
	    echo " - Optionally tweak settings (e.g. auth)."; \
	    echo " - Re-run 'make run'."; \
	    exit 1; \
	fi
	tools/devrun.sh dev.json

test:
	(cd test && $(MAKE) test)

# Publish docs to Github pages.
.PHONY: publish
publish: docs
	mkdir -p tmp
	[[ -d tmp/gh-pages ]] || git clone git@github.com:trentm/molybdenum.git tmp/gh-pages
	cd tmp/gh-pages && git checkout gh-pages && git pull --rebase origin gh-pages
	cp -PR build/docs/public/ tmp/gh-pages/
	(cd tmp/gh-pages \
		&& git add -A \
		&& git commit -a -m "publish latest docs" \
		&& git push origin gh-pages || true)


include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.targ
