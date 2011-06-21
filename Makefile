
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

.PHONY: all test run help docs

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

deps: $(REDIS_SERVER)

# Use 'Makefile' landmarks instead of the dir itself, because dir mtime
# is that of the most recent file: results in unnecessary rebuilds.
deps/redis/Makefile:
	(GIT_SSL_NO_VERIFY=1 git submodule update --init)

$(REDIS_SERVER): deps/redis/Makefile
	(cd deps/redis && make)


#
# Run, test, etc.
#

tmp:
	mkdir -p tmp

run: tmp 
	support/devrun.sh

# To setup for using restdown <https://github.com/trentm/restdown>:
#   git clone git://github.com/trentm/restdown.git
#   export PATH=`pwd`/restdown/bin:$PATH
docs:
	restdown -v -m static/static docs/api.md

test:
	(cd test && make test)

clean:
	TODO:clean
	(cd deps/redis && $(MAKE) clean)
