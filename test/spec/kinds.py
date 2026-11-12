# Checks that spec examples of the statements with their own rule parse as that rule, not as the
# generic `statement` fallback, which accepts nearly anything.
#
#   python3 -I test/spec/kinds.py <spec-verdicts.tsv>
import re
import subprocess
import sys

EXPECT = [
    (r"(SELECT|WITH)\b", "select_statement"),
    (r"INSERT\b", "insert_statement"),
    (r"UPDATE\b", "update_statement"),
    (r"DELETE\b", "delete_statement"),
    (r"MERGE\b", "merge_statement"),
    (r"DECLARE\s+\S+\s+(NO\s+SCROLL|SCROLL|ASENSITIVE|INSENSITIVE|SENSITIVE|CURSOR)\b", "declare_cursor_statement"),
    (r"DECLARE\s+\S+\s+TABLE\b", "declare_table_statement"),
    (r"CREATE\s+(GLOBAL\s+TEMPORARY\s+)?TABLE\b", "create_table_statement"),
    (r"CREATE\s+(OR\s+REPLACE\s+)?VIEW\b", "create_view_statement"),
    (r"CREATE\s+(UNIQUE\s+(WHERE\s+NOT\s+NULL\s+)?)?INDEX\b", "create_index_statement"),
    (r"CREATE\s+(PUBLIC\s+)?(ALIAS|SYNONYM)\b", "create_alias_statement"),
    (r"OPEN\b", "open_statement"),
    (r"CLOSE\b", "close_statement"),
    (r"FETCH\b", "fetch_statement"),
    (r"CALL\b", "call_statement"),
    (r"INCLUDE\b", "include_statement"),
]

verdicts = sys.argv[1]
paths = [line.split("\t")[0] for line in open(verdicts) if line.strip()]
paths_file = verdicts + ".paths"
open(paths_file, "w").write("\n".join(paths) + "\n")
output = subprocess.run(["tree-sitter", "parse", "--paths", paths_file], capture_output=True, text=True).stdout
trees = output.split("(source_file")[1:]
if len(trees) != len(paths):
    print(f"kinds: [SK002] got {len(trees)} trees for {len(paths)} files", file=sys.stderr)
    sys.exit(2)

wrong = 0
for path, tree in zip(paths, trees):
    sql = re.sub(r"^EXEC SQL\s+", "", open(path).read(), flags=re.I)
    expected = next((kind for pattern, kind in EXPECT if re.match(pattern, sql, re.I)), None)
    if expected is None or "(ERROR" in tree or "(MISSING" in tree:
        continue
    match = re.search(r"^  (?:\(exec_sql [^\n]*\n    )?\((\w+)", tree, re.M)
    actual = match.group(1) if match else "?"
    if actual != expected:
        wrong += 1
        print(f"kinds: [SK001] {path} parses as {actual}, expected {expected}", file=sys.stderr)
print(f"kinds: {wrong} of {len(paths)} parse as the wrong statement")
sys.exit(1 if wrong else 0)
