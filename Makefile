help:
	@echo "help: show this help"
	@echo "run: run a local development Hub"
	@echo "docs: rebuild the docs"
	@echo "test: run the test suite"

run:
	node app.js

# To setup for using restdown <https://github.com/trentm/restdown>:
#   git clone git://github.com/trentm/restdown.git
#   export PATH=`pwd`/restdown/bin:$PATH
docs:
	restdown -v -m static docs/api.md

#deploy:
#	git push production develop:master

test:
	(cd test && make test)

.PHONY: test run help docs
