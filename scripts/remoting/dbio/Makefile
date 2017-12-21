TSC=tsc --noImplicitAny --noImplicitReturns -t es2015

ROOTDIR=../../..

PROGRAMS=dbio.node.js

include $(ROOTDIR)/util/mmk

test: dbio

dbio: dbio.node.js

dbio.node.js: force
	make -C ../../feg tsc
	make -C .. tsc
	npm update
	$(GENINCJS) \
		"--mode=js" \
		"--rootdir=$(ROOTDIR)" \
		"--out_file=$@" \
		"--template=dbio.template" \
		dbio.js
