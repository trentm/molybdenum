
ifeq ($(VERSION), "")
	@echo "Use gmake"
endif


#
# Config
#

# Directories
TOP := $(shell pwd)
NODEDIR = $(TOP)/deps/node-install

# Tools
MAKE = make
TAR = tar
CC = gcc
UNAME := $(shell uname)
ifeq ($(UNAME), SunOS)
	MAKE = gmake
	TAR = gtar
endif

REDIS_SERVER := deps/redis/src/redis-server
NPM := npm_config_tar=$(TAR) npm


#
# Targets
#

.PHONY: all test run help docs deps optional_deps

help:
	@echo "help: show this help"
	@echo "all: build all (most dependencies)"
	@echo "docs: rebuild the docs"
	@echo "test: run the test suite"
	@echo "run: run a local development Molybdenum"

all:: deps


#
# Deps
#

deps: $(REDIS_SERVER) node_modules/express
optional_deps: node_modules/sdc-clients

# Using 'express' as the landmark for all node deps in package.json.
node_modules/express:
	$(NPM) install

# Use 'Makefile' landmarks instead of the dir itself, because dir mtime
# is that of the most recent file: results in unnecessary rebuilds.
deps/redis/Makefile:
	(GIT_SSL_NO_VERIFY=1 git submodule update --init)

$(REDIS_SERVER): deps/redis/Makefile
	(cd deps/redis && CC=$(CC) $(MAKE))

node_modules/sdc-clients:
	mkdir -p node_modules
	git clone git@git.joyent.com:node-sdc-clients.git node_modules/sdc-clients
	(cd node_modules/sdc-clients && $(NPM) install)


#
# Run, test, etc.
#

tmp:
	mkdir -p tmp

run: tmp 
	@if [ ! -f dev.ini ]; then \
	    echo "error: 'dev.ini' does not exist."; \
	    echo " - Create it: 'cp tools/dev.ini.in dev.ini'"; \
	    echo " - Optionally tweak settings (e.g. auth)."; \
	    echo " - Re-run 'make run'."; \
	    exit 1; \
	fi
	tools/devrun.sh dev.ini
redis-cli:
	deps/redis/src/redis-cli -p 6401

doc:
	./tools/restdown -v -b tools/restdown-brand -m static/static docs/api.md

test:
	(cd test && $(MAKE) test)

clean:
	TODO:clean
	(cd deps/redis && $(MAKE) clean)
