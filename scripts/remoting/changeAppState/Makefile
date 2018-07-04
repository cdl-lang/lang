TSC=tsc --noImplicitAny --noImplicitReturns -t es2015

PROGRAM=changeAppState.node.js

LANGDIR=../../..

include $(LANGDIR)/util/mmk

changeAppState.node.js: force
	make -C ../../feg tsc
	make -C .. tsc
	$(GENINCJS) \
		"--mode=js" \
		"--langdir=$(LANGDIR)" \
		"--out_file=$@" \
		"--template=changeAppState.template" \
		changeAppState.js

force:
