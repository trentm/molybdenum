test:
	@echo "Setup test hub server."
	@mkdir -p tmp
	@rm -rf tmp/data && mkdir tmp/data
	@(cd tmp && tar xf ../fixtures/eol.git.tgz)
	@node ../app.js -c test.ini >tmp/hub.log &
	@sleep 1  # let it startup
	@echo '{"repository": {"url": "tmp/eol.git", "name": "eol"}}' | curl -sS http://localhost:3334/api/repos/eol -X POST -d @- >/dev/null
	@sleep 1  # let it clone eol
	@echo "--"
	(NODE_PATH=node_modules node_modules/.bin/nodeunit test.js; kill `cat tmp/hub.pid`)

.PHONY: test
