
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
UNAME := $(shell uname)
ifeq ($(UNAME), SunOS)
	MAKE = gmake
	TAR = gtar
	CC = gcc
	CCFLAGS	= -fPIC -g -Wall
	LDFLAGS	= -static-libgcc
	LIBS = -lpthread -lzonecfg -L/lib -lnsl -lsocket
endif

NODE := $(NODEDIR)/bin/node
NODE_WAF := $(NODEDIR)/bin/node-waf
NPM_ENV := npm_config_cache=$(shell echo $(TOP)/tmp/npm-cache) npm_config_tar=$(TAR) PATH=$(NODEDIR)/bin:$$PATH
NPM := $(NPM_ENV) $(NODEDIR)/bin/npm
NODE_DEV := PATH=$(NODEDIR)/bin:$$PATH node-dev
REDIS_SERVER := deps/redis/src/redis-server



#
# Targets
#

.PHONY: all test run help docs deps optional_deps

help:
	@echo "help: show this help"
	@echo "all: build all (most dependencies)"
	@echo "docs: rebuild the docs"
	@echo "test: run the test suite"
	@echo "run: run a local development Hub"

all:: deps


#
# Deps
#

deps: $(REDIS_SERVER) node_modules/express
optional_deps: node_modules/sdc-clients

# Using 'express' as the landmark for all node deps in package.json.
node_modules/express:
	npm install

# Use 'Makefile' landmarks instead of the dir itself, because dir mtime
# is that of the most recent file: results in unnecessary rebuilds.
deps/redis/Makefile:
	(GIT_SSL_NO_VERIFY=1 git submodule update --init)

$(REDIS_SERVER): deps/redis/Makefile
	(cd deps/redis && make)

node_modules/sdc-clients:
	mkdir -p node_modules
	git clone git@git.joyent.com:node-sdc-clients.git node_modules/sdc-clients
	(cd node_modules/sdc-clients && npm install)


#
# Run, test, etc.
#

tmp:
	mkdir -p tmp

run: tmp 
	@if [ ! -f dev.ini ]; then \
	    echo "error: 'dev.ini' does not exist."; \
	    echo " - Create it: 'cp support/dev.ini.in dev.ini'"; \
	    echo " - Optionally tweak settings (e.g. auth)."; \
	    echo " - Re-run 'make run'."; \
	    exit 1; \
	fi
	support/devrun.sh dev.ini
redis-cli:
	deps/redis/src/redis-cli -p 6401

docs:
	./support/restdown -v -b support/restdown-brand -m static/static docs/api.md

test:
	(cd test && make test)

clean:
	TODO:clean
	(cd deps/redis && $(MAKE) clean)
