# Ethereals N ADS — build orchestration
# Everything real happens in tools/build.mjs (Node, zero npm deps).

NODE ?= node
export DEV ?= 0

.PHONY: help assets refresh stage chromium firefox all icons clean clean-win test unit e2e package

help:
	@echo "targets:"
	@echo "  make assets      — download upstream filter lists (network)"
	@echo "  make refresh     — re-download lists ignoring cache"
	@echo "  make chromium    — build dist/chromium (+ artifacts if DEV=0)"
	@echo "  make firefox     — build dist/firefox"
	@echo "  make all         — chromium + firefox"
	@echo "  make icons       — regenerate src/img icons"
	@echo "  make test        — unit + e2e"
	@echo "  make clean       — remove dist/ and build/stage"
	@echo "  make clean-win   — same as clean for Windows PowerShell"

assets:
	$(NODE) tools/build.mjs assets

refresh:
	$(NODE) tools/build.mjs assets --refresh

stage:
	$(NODE) tools/build.mjs stage

chromium:
	$(NODE) tools/build.mjs compile chromium

firefox:
	$(NODE) tools/build.mjs compile firefox

all: chromium firefox

icons:
	$(NODE) tools/build.mjs icons

test: unit e2e

unit:
	$(NODE) --test test/unit/

e2e:
	$(NODE) test/e2e/run.mjs

clean:
	rm -rf dist build/stage build/mv3-data

clean-win:
	powershell -NoProfile -Command "Remove-Item -Recurse -Force dist,build/stage,build/mv3-data -ErrorAction SilentlyContinue"
