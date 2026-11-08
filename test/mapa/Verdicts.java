import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.antlr.v4.runtime.*;
import org.antlr.v4.runtime.atn.PredictionMode;
import org.antlr.v4.runtime.misc.ParseCancellationException;
import org.antlr.v4.runtime.tree.ParseTree;
import org.antlr.v4.runtime.tree.TerminalNode;

// Parses every file listed in <paths file> with mapa's DB2zSQL parser, splits it into its
// top-level statements, writes each statement's text (without its terminator) to
// <out dir>/<file>-<n>.sql and prints "<statement file>\tok|error\t<first error>" per statement.
// A syntax error belongs to the statement it lies in (or the last one starting before it).
public class Verdicts {
    record SyntaxError(int offset, String message) {}

    public static void main(String[] args) throws Exception {
        Path outDir = Path.of(args[1]);
        for (String line : Files.readAllLines(Path.of(args[0]))) {
            if (line.isBlank()) continue;
            Path path = Path.of(line);
            String text = Files.readString(path, java.nio.charset.StandardCharsets.ISO_8859_1);
            int[] lineStarts = lineStarts(text);
            List<SyntaxError> errors = new ArrayList<>();
            ParserRuleContext tree = parse(text, lineStarts, errors);

            List<int[]> ranges = new ArrayList<>();
            for (ParseTree child : childrenOf(tree)) {
                if (!(child instanceof ParserRuleContext statement) || statement.start == null) continue;
                int start = statement.start.getStartIndex();
                int stop = lastNonTerminatorStop(statement);
                if (start < 0 || stop < start) continue;
                ranges.add(new int[] {start, stop});
            }
            if (ranges.isEmpty()) {
                System.err.println("verdicts: no statements in " + path);
                continue;
            }

            String[] firstError = new String[ranges.size()];
            for (SyntaxError error : errors) {
                int owner = 0;
                for (int i = 0; i < ranges.size(); i++) if (ranges.get(i)[0] <= error.offset()) owner = i;
                if (firstError[owner] == null) firstError[owner] = error.message();
            }

            String base = path.getFileName().toString();
            for (int i = 0; i < ranges.size(); i++) {
                Path out = outDir.resolve(String.format("%s-%04d.sql", base, i + 1));
                Files.writeString(out, text.substring(ranges.get(i)[0], ranges.get(i)[1] + 1) + "\n",
                        java.nio.charset.StandardCharsets.ISO_8859_1);
                String verdict = firstError[i] == null ? "ok" : "error";
                String message = firstError[i] == null ? "" : firstError[i].replaceAll("[\t\r\n]+", " ");
                System.out.println(out + "\t" + verdict + "\t" + message);
            }
        }
    }

    // SLL first (fast); only if that fails, LL with error reporting, which gives ANTLR's real verdict.
    static ParserRuleContext parse(String text, int[] lineStarts, List<SyntaxError> errors) {
        DB2zSQLParser parser = new DB2zSQLParser(new CommonTokenStream(lexer(text, lineStarts, errors)));
        parser.removeErrorListeners();
        parser.setErrorHandler(new BailErrorStrategy());
        parser.getInterpreter().setPredictionMode(PredictionMode.SLL);
        try {
            ParserRuleContext tree = parser.startRule();
            if (errors.isEmpty()) return tree;
        } catch (ParseCancellationException e) {
            // fall through to the full LL parse
        }
        errors.clear();
        parser = new DB2zSQLParser(new CommonTokenStream(lexer(text, lineStarts, errors)));
        parser.removeErrorListeners();
        parser.addErrorListener(collector(lineStarts, errors));
        return parser.startRule();
    }

    static DB2zSQLLexer lexer(String text, int[] lineStarts, List<SyntaxError> errors) {
        DB2zSQLLexer lexer = new DB2zSQLLexer(CharStreams.fromString(text));
        lexer.removeErrorListeners();
        lexer.addErrorListener(collector(lineStarts, errors));
        return lexer;
    }

    static BaseErrorListener collector(int[] lineStarts, List<SyntaxError> errors) {
        return new BaseErrorListener() {
            @Override
            public void syntaxError(Recognizer<?, ?> r, Object symbol, int line, int col, String msg, RecognitionException e) {
                int offset = symbol instanceof Token t && t.getStartIndex() >= 0
                        ? t.getStartIndex()
                        : lineStarts[Math.min(line, lineStarts.length) - 1] + col;
                errors.add(new SyntaxError(offset, line + ":" + col + " " + msg));
            }
        };
    }

    static List<ParseTree> childrenOf(ParserRuleContext tree) {
        List<ParseTree> children = new ArrayList<>();
        for (int i = 0; i < tree.getChildCount(); i++) children.add(tree.getChild(i));
        return children;
    }

    // A statement ends with ';', a SPUFI terminator or EOF; leave those out of its text.
    static int lastNonTerminatorStop(ParserRuleContext statement) {
        for (int i = statement.getChildCount() - 1; i >= 0; i--) {
            ParseTree child = statement.getChild(i);
            if (child instanceof TerminalNode terminal) {
                int type = terminal.getSymbol().getType();
                if (type == DB2zSQLLexer.SEMICOLON || type == DB2zSQLLexer.SQL_STATEMENT_TERMINATOR || type == Token.EOF) continue;
                return terminal.getSymbol().getStopIndex();
            }
            if (child instanceof ParserRuleContext rule && rule.stop != null && rule.stop.getType() != Token.EOF) {
                return rule.stop.getStopIndex();
            }
        }
        return -1;
    }

    static int[] lineStarts(String text) {
        List<Integer> starts = new ArrayList<>(List.of(0));
        for (int i = 0; i < text.length(); i++) if (text.charAt(i) == '\n') starts.add(i + 1);
        return starts.stream().mapToInt(Integer::intValue).toArray();
    }
}
