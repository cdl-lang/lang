LANGDIR=../../..

PROGRAMS=persistenceServer.node.js

include $(LANGDIR)/util/mmk

test: persistenceServer
	node persistenceServer.node.js localMode=true

dtest: persistenceServer
	node persistenceServer.node.js localMode=true debugRemote=2

authtest: persistenceServer
	node persistenceServer.node.js authRootDir=$(CURDIR)/authWS

persistenceServer: persistenceServer.node.js

persistenceServer.node.js: force
	make -C ../../feg tsc
	make -C .. tsc
	npm update
	$(GENINCJS) \
		"--mode=js" \
		"--langdir=$(LANGDIR)" \
		"--out_file=$@" \
		"--template=persistenceServer.template" \
		persistenceServer.js

