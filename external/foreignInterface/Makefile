TSC=tsc --noImplicitAny --noImplicitReturns -t es2015

# Keep intermediate files
.SECONDARY:

.PHONY: clean tsc

TSSOURCES=getGeoJSON.foreign.ts graphCanvas.foreign.ts googlemaps.foreign.ts

tsc: $(TSSOURCES:%.foreign.ts=%.foreign.js)

%.foreign.js: %.foreign.ts ../../scripts/feg/include/feg/cdl.d.ts
	$(TSC) $<

clean:
	rm $(TSSOURCES:%.foreign.ts=%.foreign.js)