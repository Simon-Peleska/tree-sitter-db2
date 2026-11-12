#!/usr/bin/env bash
# Parses the SQL examples of IBM's Db2 12 for z/OS SQL Reference with this grammar.
#
#   nix develop -c test/spec/run.sh [--update]
#
# Downloads the manual into test/spec/.work (IBM's text is not ours to commit), extracts every
# example statement and checks that
#   - the accept/reject verdicts match test/spec/baseline.tsv: only the mistakes in the manual
#     listed in test/spec/errata.tsv are rejected, and
#   - statements with their own rule don't fall back to the generic `statement` rule.
set -euo pipefail

PDF_URL=https://www.ibm.com/docs/en/SSEPEK_12.0.0/pdf/db2z_12_sqlrefbook.pdf
here=$(cd "$(dirname "$0")" && pwd)
work=$here/.work

mkdir -p "$work"
if [ ! -f "$work/sqlref.pdf" ]; then
	echo "run: downloading $PDF_URL"
	curl -fsSL -o "$work/sqlref.pdf.part" "$PDF_URL"
	mv "$work/sqlref.pdf.part" "$work/sqlref.pdf"
fi
if [ ! -f "$work/sqlref.xml" ] || [ "$work/sqlref.pdf" -nt "$work/sqlref.xml" ]; then
	pdftohtml -xml -i -q "$work/sqlref.pdf" "$work/sqlref" >/dev/null
fi

rm -rf "$work/statements"
python3 -I "$here/extract.py" "$work/sqlref.xml" "$work/statements" "$work/spec-verdicts.tsv"
status=0
node "$here/../compare.mjs" "$work/spec-verdicts.tsv" "$here/baseline.tsv" "$@" || status=$?
python3 -I "$here/kinds.py" "$work/spec-verdicts.tsv" || status=$?
exit $status
