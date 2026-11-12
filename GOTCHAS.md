# Gotchas

- Keywords are not reserved: wherever a keyword is not valid it is read as an
  identifier. `SELECT FROM T1` parses without error (`FROM` is a column name).
  Db2 does the same for most of its keywords, so this grammar is lenient
  rather than a validator.
- Only `;` ends a statement. `--#SET TERMINATOR` and other SPUFI/DSNTEP2
  terminators are not supported.
- Strings with unescaped quotes inside them (`DSNUTIL` control statements
  passed as strings) are parse errors.
- `]]` and `!!` are not concatenation operators; only `||` and `CONCAT` are.
- Function arguments, `OVER (...)` and `WITHIN GROUP (...)` are token lists
  (`arguments`), not expressions. Subqueries inside them are still `subquery`
  nodes.
- Most DDL (`ALTER`, `CREATE TABLESPACE`, `CREATE PROCEDURE`, ...) and other
  statements are generic `statement` nodes with a token list. Only the
  statements listed in the README have a structured tree.
- mapa's test data contains only valid SQL, so the comparison tests what this
  grammar accepts, not what it rejects. The corpus has the error tests.
- `test/mapa/run.sh` takes about 40 s.
- Some multi-word constructs are single tokens: `DATE`, `TIME` or
  `TIMESTAMP` followed by a string (`datetime_literal`), the special registers
  of several words (`CURRENT DEBUG MODE`, `SESSION TIME ZONE`, `CLIENT
  USERID`, ...) and `WITH TIME ZONE`. That keeps `DATE(x)`, `SESSION.T` and
  columns named `CLIENT` working and the parser fast, but a comment between
  those words breaks them.
- Statement ids in `test/spec/baseline.tsv` are the page plus a hash of the
  statement. When IBM updates the manual, changed or moved examples show up as
  verdict changes; look at them and rerun with `--update`. An errata id that no
  longer matches any statement prints `[SX001]`; fix its id in
  `test/spec/errata.tsv`.
