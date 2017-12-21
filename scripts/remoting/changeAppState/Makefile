TSC=tsc --noImplicitAny --noImplicitReturns -t es2015

PROGRAM=changeAppState.node.js

ROOTDIR=../../..

include $(ROOTDIR)/util/mmk

changeAppState.node.js: force
	make -C ../../feg tsc
	make -C .. tsc
	$(GENINCJS) \
		"--mode=js" \
		"--rootdir=$(ROOTDIR)" \
		"--out_file=$@" \
		"--template=changeAppState.template" \
		changeAppState.js

force:
