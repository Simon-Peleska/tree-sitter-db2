# Extracts the SQL examples from IBM's Db2 12 for z/OS SQL Reference.
#
#   python3 -I test/spec/extract.py <sqlref.xml> <out-dir> <verdicts.tsv>
#
# Reads the output of `pdftohtml -xml`. The manual sets every example in a monospace font, so a row of
# text that starts in that font is code, and prose, headings and diagrams between such rows separate
# the code blocks. Writes one file per statement, named by page and content hash so ids survive
# extractor changes, and <verdicts.tsv> in the format test/compare.mjs reads. Every
# example counts as valid unless errata.tsv lists it as a mistake in the manual.
import hashlib
import html
import os
import re
import sys

HEADS = (
    "SELECT|INSERT|UPDATE|DELETE|MERGE|WITH|VALUES|CREATE|ALTER|DROP|GRANT|REVOKE|SET|DECLARE|"
    "EXEC|EXECUTE|CALL|COMMIT|ROLLBACK|LOCK|COMMENT|LABEL|RENAME|TRUNCATE|FETCH|OPEN|CLOSE|PREPARE|DESCRIBE|"
    "CONNECT|RELEASE|SAVEPOINT|SIGNAL|RESIGNAL|GET|EXPLAIN|REFRESH|EXCHANGE|TRANSFER|FREE|HOLD|ASSOCIATE|"
    "ALLOCATE|INCLUDE|BEGIN|END|WHENEVER"
)
start_re = re.compile(rf"^\s*\(?({HEADS})(\b[ (A-Z:*\"]|$)")
token_re = re.compile(r"'[^']*'?|\"[^\"]*\"?|--.*|[A-Za-z_][A-Za-z0-9_#$@]*|;")
fontspec_re = re.compile(r'\s*<fontspec id="(\d+)" .*family="([^"]+)"')
page_re = re.compile(r'<page number="(\d+)"')
text_re = re.compile(r'<text top="(\d+)" left="(\d+)" width="(\d+)" height="\d+" font="(\d+)">(.*)</text>')
# The page footer must not split an example that crosses a page.
FOOTER_START = 1120
# Prose that contains inline code touches it; a margin note next to an example is further away.
MARGIN_GAP = 30


def scan(sql, quote, depth):
    if quote:
        close = sql.find(quote)
        if close < 0:
            return quote, depth, False
        sql, quote = sql[close + 1:], None
    words = []
    for token in token_re.findall(sql):
        if token[0] in "'\"":
            if len(token) == 1 or token[-1] != token[0]:
                quote = token[0]
        elif not token.startswith("--"):
            words.append(token.upper())
    for n, w in enumerate(words):
        nxt = words[n + 1] if n + 1 < len(words) else ""
        prev = words[n - 1] if n > 0 else ""
        if w == "BEGIN" and nxt != "DECLARE":
            depth += 1
        elif w == "CASE" and prev != "END":
            depth += 1
        elif w == "END" and nxt not in ("IF", "LOOP", "WHILE", "REPEAT", "FOR", "DECLARE"):
            depth -= 1
    depth = max(depth, 0)
    return quote, depth, words[-1:] == [";"] and quote is None and depth == 0


mono = set()
rows = {}
for line in open(sys.argv[1], encoding="utf-8"):
    if m := fontspec_re.match(line):
        if "Mono" in m.group(2):
            mono.add(m.group(1))
    elif m := page_re.match(line):
        page = int(m.group(1))
    elif m := text_re.match(line):
        top, left, width, font, raw = m.groups()
        text = html.unescape(re.sub(r"</?[a-z]+>", "", raw)).replace("‘", "'").replace("’", "'")
        if text.strip():
            rows.setdefault((page, int(top)), []).append((int(left), int(width), font in mono, text))

# The code rows in reading order as (page, top, text), with None wherever prose separates them. Text
# that starts right of the code on the same page is a margin note or the next cell of a table, so it
# neither separates examples nor belongs to them.
code = []
code_right = None
for (page, top), runs in sorted(rows.items()):
    runs.sort()
    first_left, first_width, first_mono, first_text = runs[0]
    if code_right is not None and first_left > code_right + MARGIN_GAP and code[-1][0] == page:
        continue
    text = first_text if first_mono else None
    right = first_left + first_width
    char_width = first_width / max(len(first_text), 1)
    for left, width, is_mono, run in runs[1:] if first_mono else []:
        if not is_mono:
            text = None if left <= right + MARGIN_GAP else text
            break
        text = text.ljust(round((left - first_left) / char_width)) + run
        right = left + width
    if text is None:
        if top < FOOTER_START and code[-1:] != [None]:
            code.append(None)
            code_right = None
        continue
    code.append((page, top, text.rstrip()))
    code_right = max(code_right or 0, right)

statements = []
quote = None
i = 0
while i < len(code):
    if code[i] is None:
        quote = None
        i += 1
        continue
    page, top, line = code[i]
    if quote or not start_re.match(line):
        quote = scan(line, quote, 0)[0]
        i += 1
        continue
    block = [line]
    first_quote, depth, done = scan(line, None, 0)
    block_quote = first_quote
    j = i
    while not done and j + 1 < len(code) and code[j + 1] is not None:
        j += 1
        block.append(code[j][2])
        block_quote, depth, done = scan(code[j][2], block_quote, depth)
    if done:
        indent = min(len(l) - len(l.lstrip()) for l in block if l.strip())
        sql = "\n".join(l[indent:] for l in block)
        if "..." not in sql and "…" not in sql:
            statements.append((page, sql))
        i = j + 1
    else:
        quote = first_quote
        i += 1

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "errata.tsv")) as f:
    errata = {row.split("\t")[0] for row in f if row.strip() and not row.startswith("#")}

out = os.path.abspath(sys.argv[2])
os.makedirs(out, exist_ok=True)
with open(sys.argv[3], "w") as verdicts:
    written = set()
    for page, sql in statements:
        id = f"p{page:04d}-{hashlib.sha256(sql.encode()).hexdigest()[:8]}"
        if id in written:
            continue
        written.add(id)
        path = os.path.join(out, id + ".sql")
        with open(path, "w") as f:
            f.write(sql + "\n")
        verdicts.write(f"{path}\t{'error' if id in errata else 'ok'}\t\n")
for id in sorted(errata - written):
    print(f"[SX001] errata entry {id} matches no extracted statement", file=sys.stderr)
print(f"extract: {len(written)} statements")
