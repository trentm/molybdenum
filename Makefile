#
# Copyright (c) 2013 Trent Mick. All rights reserved.
# Copyright (c) 2013 Joyent, Inc. All rights reserved.
#

JS_FILES := $(shell find lib -name "*.js")
JSL_CONF_NODE = tools/jsl.node.conf
JSL_FILES_NODE = $(JS_FILES)
JSSTYLE_FILES = $(JS_FILES)
JSSTYLE_FLAGS = -o indent=4,doxygen,unparenthesized-return=0
DOC_FILES = index.restdown
BUNYAN = ./node_modules/.bin/bunyan
NODEDEV = ./node_modules/.bin/node-dev

include ./tools/mk/Makefile.defs


#
# Targets
#

.PHONY: all
all:
	npm install

.PHONY: test
test:
	./node_modules/.bin/nodeunit test/*.test.js

.PHONY: devrun
devrun:
	[[ -f etc/molybdenumd.config.json ]] || (echo "error: no etc/molybdenumd.config.json, copy it from etc/molybdenumd.config.json.in" && exit 1)
	$(NODEDEV) ./bin/molybdenumd.js -v -f etc/molybdenumd.config.json | $(BUNYAN) -o long

CLEAN_FILES += node_modules


include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.targ
