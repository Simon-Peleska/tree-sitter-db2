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
