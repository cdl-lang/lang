ROOTDIR=../../..

include $(ROOTDIR)/util/mmk

authorizationUtil: authorizationUtil.node.js

authorizationUtil.node.js: force
	make -C ../../feg tsc
	make -C .. tsc
	$(GENINCJS) \
		"--mode=js" \
		"--rootdir=$(ROOTDIR)" \
		"--out_file=$@" \
		"--template=authorizationUtil.template" \
		authorizationUtil.js

force:
