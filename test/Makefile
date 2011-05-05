test:
	@echo "Setup test hub server."
	@mkdir -p tmp
	@rm -rf tmp/data && mkdir tmp/data
	@(cd tmp && tar xf ../fixtures/eol.git.tgz)
	@node ../app.js -c test.ini >tmp/hub.log &
	@echo "Wait for test server to start up."
	@while [[ -z "`curl -sS localhost:3334/api/ping 2>/dev/null | grep pong`" ]]; do sleep 1; done;
	@echo '{"repository": {"url": "tmp/eol.git", "name": "eol"}}' | curl -sS http://localhost:3334/api/repos/eol -X POST -d @- >/dev/null
	@sleep 1  # let it clone eol
	@echo "--"
	(NODE_PATH=node_modules node_modules/.bin/nodeunit test.js; kill `cat tmp/hub.pid`)

.PHONY: test
