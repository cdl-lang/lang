TSC=tsc --noImplicitAny --noImplicitReturns -t es2015

LANGDIR=../../..

PROGRAMS=dbio.node.js

include $(LANGDIR)/util/mmk

test: dbio

dbio: dbio.node.js

dbio.node.js: force
	make -C ../../feg tsc
	make -C .. tsc
	npm update
	$(GENINCJS) \
		"--mode=js" \
		"--langdir=$(LANGDIR)" \
		"--out_file=$@" \
		"--template=dbio.template" \
		dbio.js
