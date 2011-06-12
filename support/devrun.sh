#!/bin/bash
#
# Setup and run all the Hub components with a dev configuration.
# If you have `multitail` it will tail the redis and main server logs.
#
# Usage:
#   support/devrun.sh
#

if [ "$DEBUG" != "" ]; then
    shift;
    export PS4='${BASH_SOURCE}:${LINENO}: '
    set -o xtrace
fi
set -o errexit

ROOT=$(cd $(dirname $0)/../; pwd)
NODE_DEV="env LD_PRELOAD_32=/usr/lib/extendedFILE.so.1 PATH=${ROOT}/deps/node-install/bin:$PATH node-dev"



#---- support functions

function fatal {
    echo "$(basename $0): error: $1"
    exit 1
}

function errexit {
    [[ $1 -ne 0 ]] || exit 0
    cleanup
    fatal "error exit status $1 at line $2"
}

function cleanup {
    echo "== cleanup"
    kill `cat $ROOT/tmp/dev-redis.pid`
    ps -ef | grep node-de[v] | awk '{print $2}' | xargs kill
}


#---- mainline

trap 'errexit $? $LINENO' EXIT

echo "== preclean"
[[ -e $ROOT/tmp/dev-redis.pid ]] && kill `cat $ROOT/tmp/dev-redis.pid` && sleep 1 || true
ps -ef | grep node-de[v] | awk '{print $2}' | xargs kill

echo "== start redis (tmp/dev-redis.log)"
$ROOT/deps/redis/src/redis-server $ROOT/support/dev-redis.conf

echo "== start hub (tmp/dev-hub.log)"
${NODE_DEV} $ROOT/app.js > $ROOT/tmp/dev-hub.log 2>&1 &
sleep 1

echo "== tail the logs ..."
multitail -f $ROOT/tmp/dev-redis.log $ROOT/tmp/dev-hub.log

cleanup
