#!/bin/bash
#
# Setup and run all the Molybdenum components with a dev configuration.
# If you have `multitail` it will tail the redis and main server logs.
#
# Usage:
#   tools/devrun.sh HUB-INI-PATH
#

if [ "$DEBUG" != "" ]; then
    shift;
    export PS4='${BASH_SOURCE}:${LINENO}: '
    set -o xtrace
fi
set -o errexit

ROOT=$(cd $(dirname $0)/../; pwd)
NODE_DEV="env PATH=${ROOT}/node_modules/.bin:$PATH node-dev"



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
    [[ -e $ROOT/tmp/redis.pid ]] && kill `cat $ROOT/tmp/redis.pid`
    ps -ef | grep node-de[v] | awk '{print $2}' | xargs kill
}


#---- mainline

trap 'errexit $? $LINENO' EXIT

HUB_INI_PATH=$1
if [[ ! -f "$HUB_INI_PATH" ]]; then
    fatal "Molybdenum ini path '${HUB_INI_PATH}' does not exist."
fi

echo "== preclean"
mkdir -p tmp/data
[[ -e $ROOT/tmp/redis.pid ]] && kill `cat $ROOT/tmp/redis.pid` && sleep 1 || true
ps -ef | grep node-de[v] | awk '{print $2}' | xargs kill

#echo "== start redis (tmp/redis.log)"
#$ROOT/deps/redis/src/redis-server $ROOT/tools/redis.conf

echo "== start molybdenum (tmp/molybdenum.log)"
${NODE_DEV} $ROOT/app.js -c $HUB_INI_PATH > $ROOT/tmp/molybdenum.log 2>&1 &
sleep 1

echo "== tail the logs ..."
#multitail -f $ROOT/tmp/redis.log $ROOT/tmp/molybdenum.log
tail -f $ROOT/tmp/molybdenum.log

cleanup
