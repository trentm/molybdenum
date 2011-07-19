#!/bin/bash
#
# Setup and run the Hub test suite.
#
# Usage:
#   make test
#

if [ "$DEBUG" != "" ]; then
    shift;
    export PS4='${BASH_SOURCE}:${LINENO}: '
    set -o xtrace
fi
set -o errexit

ROOT=$(cd $(dirname $0)/../; pwd)
TMP=${ROOT}/test/tmp
DATADIR=${TMP}/data




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
    kill `cat ${TMP}/molybdenum.pid`
    kill `cat ${TMP}/redis.pid`
}


#---- mainline

trap 'errexit $? $LINENO' EXIT

cd ${ROOT}/test


echo "== start redis"
mkdir -p tmp
[[ -e tmp/redis.pid ]] && kill `cat tmp/redis.pid` && sleep 1 || true
$ROOT/deps/redis/src/redis-server $ROOT/test/redis.conf

echo "== start molybdenum"
rm -rf ${DATADIR}
mkdir -p ${DATADIR}
node $ROOT/app.js -c ${ROOT}/test/test.ini > tmp/molybdenum.log 2>&1 &
echo "Waiting for it to startup."
sleep 1;
while [[ -z "`curl -sS localhost:3334/api/ping | grep pong`" ]]; do
    sleep 1;
done

echo "== load fixtures"
(cd tmp && tar xf ${ROOT}/test/fixtures/eol.git.tgz)
echo '{"repository": {"url": "tmp/eol.git", "name": "eol"}}' \
    | curl -sS http://localhost:3334/api/repos/eol -X PUT -u kermit:thefrog -d @-
sleep 2  # let it clone eol

echo "== run the test suite"
NODE_PATH=node_modules node_modules/.bin/nodeunit test.js
STATUS=$?


cleanup
exit $STATUS
