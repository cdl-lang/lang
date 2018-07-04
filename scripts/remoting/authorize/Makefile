LANGDIR=../../..

include $(LANGDIR)/util/mmk

authorizationUtil: authorizationUtil.node.js

authorizationUtil.node.js: force
	make -C ../../feg tsc
	make -C .. tsc
	$(GENINCJS) \
		"--mode=js" \
		"--langdir=$(LANGDIR)" \
		"--out_file=$@" \
		"--template=authorizationUtil.template" \
		authorizationUtil.js

force:
