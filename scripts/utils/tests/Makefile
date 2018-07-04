
LANGDIR=../../..
UTIL=$(LANGDIR)/util
INCLUDEPATH=.;$(LANGDIR)

GENHTML=$(UTIL)/genHtml.pl
GENINCJS=$(UTIL)/genIncJS.awk

ifndef HTML_TEMPLATE_NAME
HTML_TEMPLATE_NAME=basicTemplate.html
endif

ifndef NODEJS_TEMPLATE_NAME
NODEJS_TEMPLATE_NAME=nodejsTemplate.node.js
endif

TEST_TEMPLATE_DIR=./templates

ifndef HTML_TEMPLATE_FILE
HTML_TEMPLATE_FILE=$(TEST_TEMPLATE_DIR)/$(HTML_TEMPLATE_NAME)
endif

ifndef NODEJS_TEMPLATE_FILE
NODEJS_TEMPLATE_FILE=$(TEST_TEMPLATE_DIR)/$(NODEJS_TEMPLATE_NAME)
endif

#$(HTML): $(GENHTML) $(HTML_TEMPLATE_FILE)

# do not try to GENHTML the template file
#$(HTML_TEMPLATE_FILE): ;

%.html: %.js
	$(GENINCJS) -v "includepath=$(INCLUDEPATH)" \
		    -v "template=$(HTML_TEMPLATE_FILE)" \
                    -v "langdir=$(LANGDIR)" \
                    -v "out=$@" -v mode=html "$<"

%.node.js: %.js
	$(GENINCJS) -v "includepath=$(INCLUDEPATH)" \
		    -v "template=$(NODEJS_TEMPLATE_FILE)" \
                    -v "langdir=$(LANGDIR)" \
                    -v "out=$@" -v mode=js "$<"
