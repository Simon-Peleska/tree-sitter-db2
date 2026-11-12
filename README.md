# tree-sitter-db2

A [tree-sitter](https://tree-sitter.github.io/) grammar for Db2 for z/OS SQL:
DDL members, SPUFI/DSNTEP2 scripts and the bodies of `EXEC SQL` blocks in
PL/I and COBOL programs. It aims at structure (which statement, which tables,
which columns, which host variables) rather than at validating every clause,
so editors and code-graph tools can read real-world SQL without choking on it.

## What it parses

- Queries in full: `WITH`, `SELECT ... INTO ... FROM ... WHERE ... GROUP BY
  ... HAVING`, set operations, `ORDER BY`, `FETCH FIRST`, `OFFSET`, `LIMIT`,
  `FOR UPDATE/READ ONLY`, isolation, `OPTIMIZE FOR`, `QUERYNO`, `SKIP LOCKED
  DATA`; joins, nested table expressions, `LATERAL`, `TABLE(...)`, `FINAL
  TABLE (INSERT ...)`, period specifications, `CASE`, `EXISTS`, `IN`,
  `BETWEEN`, `LIKE`, labeled durations, special registers (also the
  multi-word ones like `CURRENT DECFLOAT ROUNDING MODE`), datetime constants
  (`DATE '2024-01-31'`), sequence references, array constructors and
  elements (also with the `??(` `??)` trigraphs), typed correlations and
  `UNPACK(...).* AS (...)`.
- `INSERT`, `UPDATE`, `DELETE` (including `WHERE CURRENT OF`, multi-row
  `FOR n ROWS` and `INCLUDE` columns), `MERGE`.
- `DECLARE CURSOR`, `DECLARE TABLE` (DCLGEN), `OPEN`, `CLOSE`, `FETCH`,
  `CALL`, `INCLUDE`.
- `CREATE TABLE`, `CREATE VIEW`, `CREATE INDEX`, `CREATE ALIAS`, with column
  definitions, constraints and `REFERENCES`.
- Every other statement (`GRANT`, `SET`, `COMMIT`, `CREATE PROCEDURE`,
  `ALTER ...`, ...) becomes a generic `statement` node: an `operation` and a
  list of tokens. Queries inside parentheses still parse as `subquery` nodes,
  and SQL PL `BEGIN ... END` bodies with their own `;` are `compound_block`s.
- An `EXEC SQL` prefix (`exec_sql`) and a COBOL `END-EXEC`, host variables
  (`:HV`, `:HV.FIELD`, `:HV INDICATOR :IND`), parameter markers, `--` and
  `/* */` comments.

Finding the tables a statement reads or writes:

```scheme
(table_reference table: (object_name) @table)
(insert_statement table: (object_name) @table)
(update_statement table: (object_name) @table)
(delete_statement table: (object_name) @table)
(merge_statement table: (object_name) @table)
```

`queries/highlights.scm` covers keywords, names, literals and host variables.

## Development

```sh
nix develop
tree-sitter generate && tree-sitter test
```

## Comparison with mapa

[mapa](https://github.com/cschneid-the-elder/mapa) (MIT) contains an ANTLR
grammar for Db2 for z/OS SQL (`db2z`) with 238 test files. `test/mapa/run.sh`
fetches it at a pinned commit into `test/mapa/.work`, builds the parser,
splits every test file into its statements (29,325), records mapa's verdict for
each and checks both verdicts against the committed `baseline.tsv` with
`test/compare.mjs`. `--update` accepts new verdicts.

```sh
nix develop -c test/mapa/run.sh
```

Both accept 29,306 statements. mapa's test data has no negative cases, so
this grammar can only disagree by rejecting; it rejects 19:

- 16 `DSNUTIL` / utility-control strings with unescaped quotes inside a
  string, which mapa's lexer handles with special modes.
- 2 statements using `]]` and `!!` as the concatenation operator (code-page
  variants of `||`).
- 1 statement with a quoted string after a qualifier (`A.'XYZ'`).

## Comparison with the SQL Reference

`test/spec/run.sh` downloads IBM's [Db2 12 for z/OS SQL
Reference](https://www.ibm.com/docs/en/SSEPEK_12.0.0/pdf/db2z_12_sqlrefbook.pdf)
into `test/spec/.work`, extracts the example statements from all of its pages
(1,914) and checks them against `test/spec/baseline.tsv` the same way. It also
checks that the examples of every statement with its own rule parse as that
rule and not as a generic `statement`. It takes about 1 s once the PDF is
downloaded and converted.

```sh
nix develop -c test/spec/run.sh
```

The manual sets every example in a monospace font, so the extractor reads the
PDF with `pdftohtml -xml` and keeps only the text in that font. Prose,
headings, margin notes and neighbouring table cells drop out. The PDF's
typographic quotes (`‘D11’`) become `'`. Every example parses except 11 that
are wrong in the manual itself. `test/spec/errata.tsv` lists them with the
reason, and the run fails if tree-sitter accepts one:

- 4 with unbalanced parentheses or a stray comma (p. 565, 653, 670, 1098).
- A `CALL` without its `;`, which runs into the next statement (p. 890).
- 6 that contradict the manual's own syntax diagrams: `EXEC VALUES` without
  `SQL` (p. 229), `INTO` after `WHERE` (p. 1810), `FOR 5 ROWS` before
  `VALUES` (p. 2007), `UNNEST(...) AS (...)` without a correlation name
  (p. 2057), and `WHERE A='x', B='y'` (p. 2244, 2245).

An example with an unbalanced quote (p. 337) isn't extracted at all, because
the stray quote swallows the rest of its code block.

Known gaps are in `GOTCHAS.md`.
