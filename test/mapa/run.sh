#!/usr/bin/env bash
# Compares this grammar with mapa's ANTLR Db2 for z/OS SQL parser on mapa's test data.
#
#   nix develop -c test/mapa/run.sh [--update]
#
# Fetches mapa at a pinned commit into test/mapa/.work, builds its parser,
# splits every test file into its statements, records mapa's accept/reject
# verdict per statement and hands both parsers' verdicts to compare.mjs, which
# checks them against test/mapa/baseline.tsv.
set -euo pipefail

MAPA_COMMIT=6ebe2d4059f5b9b908341fea7c286856f4b544af
here=$(cd "$(dirname "$0")" && pwd)
work=$here/.work
mapa=$work/mapa
build=$work/build
statements=$work/statements

if [ "$(git -C "$mapa" rev-parse HEAD 2>/dev/null || true)" != "$MAPA_COMMIT" ]; then
	echo "run: fetching mapa $MAPA_COMMIT"
	mkdir -p "$mapa"
	git -C "$mapa" init -q
	git -C "$mapa" remote add origin https://github.com/cschneid-the-elder/mapa.git 2>/dev/null || true
	git -C "$mapa" sparse-checkout set db2z
	git -C "$mapa" fetch -q --depth 1 origin "$MAPA_COMMIT"
	git -C "$mapa" checkout -q FETCH_HEAD
fi

antlr_jar=$(dirname "$(readlink -f "$(command -v antlr4)")")/../share/java/antlr-4.13.2-complete.jar
if [ ! -f "$build/classes/Verdicts.class" ] || [ "$here/Verdicts.java" -nt "$build/classes/Verdicts.class" ]; then
	echo "run: building mapa's Db2 parser"
	mkdir -p "$build"
	cp "$mapa/db2z/src/DB2zSQLLexer.g4" "$mapa/db2z/src/DB2zSQLParser.g4" "$build/"
	(cd "$build" && java -jar "$antlr_jar" DB2zSQLLexer.g4 && java -jar "$antlr_jar" DB2zSQLParser.g4)
	javac -nowarn -J-Xmx4g -cp "$antlr_jar" -d "$build/classes" "$build"/*.java "$here/Verdicts.java"
fi

rm -rf "$statements"
mkdir -p "$statements"
ls "$mapa"/db2z/testdata/sql_* >"$work/paths.txt"
echo "run: mapa parses $(wc -l <"$work/paths.txt") files"
java -Xss64m -Xmx4g -cp "$antlr_jar:$build/classes" Verdicts "$work/paths.txt" "$statements" >"$work/mapa-verdicts.tsv"

node "$here/../compare.mjs" "$work/mapa-verdicts.tsv" "$here/baseline.tsv" "$@"
