/**
 * @file Db2 for z/OS SQL grammar for tree-sitter
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Keywords are case-insensitive. Thanks to `word`, a keyword is only a keyword
// where the grammar expects it; everywhere else it is an identifier.
const kw = (word) => alias(new RegExp(word.toLowerCase(), 'i'), word);
const kws = (...words) => seq(...words.map(kw));
const sep1 = (rule, separator) => seq(rule, repeat(seq(separator, rule)));
const commaSep1 = (rule) => sep1(rule, ',');
const space = '[\\s\\u0085\\u3000]';
const ws = space + '+';
const stringBody = "'([^']|'')*'";

const PREC = {
  set_union: 1,
  set_intersect: 2,
  or: 1,
  and: 2,
  not: 3,
  predicate: 4,
  additive: 5,
  multiplicative: 6,
  unary: 7,
  duration: 8,
};

module.exports = grammar({
  name: 'db2',

  word: $ => $.identifier,

  extras: $ => [new RegExp(space), $.comment],

  conflicts: $ => [
    [$.table_reference, $._fullselect],
    [$.table_reference],
    [$.query],
    [$._fullselect, $.subquery],
  ],

  rules: {
    source_file: $ => seq(
      repeat(choice(seq($._statement, ';'), alias($._exec_sql_end_exec, $.exec_sql), ';')),
      optional($._statement),
    ),

    _statement: $ => choice($.exec_sql, $._statement_body),
    exec_sql: $ => seq(kws('EXEC', 'SQL'), $._statement_body),
    // COBOL style: EXEC SQL ... END-EXEC. needs no ';'
    _exec_sql_end_exec: $ => seq(kws('EXEC', 'SQL'), $._statement_body, alias(/end-exec/i, 'END-EXEC'), optional('.')),

    _statement_body: $ => choice(
      $.select_statement,
      $.insert_statement,
      $.update_statement,
      $.delete_statement,
      $.merge_statement,
      $.declare_cursor_statement,
      $.declare_table_statement,
      $.create_table_statement,
      $.create_view_statement,
      $.create_index_statement,
      $.create_alias_statement,
      $.open_statement,
      $.close_statement,
      $.fetch_statement,
      $.call_statement,
      $.include_statement,
      $.statement,
    ),

    // Everything without its own rule: a head word and the tokens up to the terminator.
    statement: $ => choice(
      seq(field('operation', $.identifier), repeat($._statement_token)),
      seq(field('operation', kw('CREATE')), optional(kws('OR', 'REPLACE')), $.identifier, repeat($._statement_token)),
      seq(field('operation', kw('DECLARE')), repeat1($._statement_token)),
    ),

    // ---- queries -------------------------------------------------------------

    select_statement: $ => $.query,

    query: $ => seq(
      optional($.with_clause),
      $._fullselect,
      repeat(choice(
        $.order_by_clause,
        $.fetch_clause,
        $.offset_clause,
        $.limit_clause,
        $.for_clause,
        $.isolation_clause,
        $.optimize_clause,
        $.queryno_clause,
        $.skip_locked_clause,
      )),
    ),

    with_clause: $ => seq(kw('WITH'), commaSep1($.common_table_expression)),
    common_table_expression: $ => seq(
      field('name', $._name),
      optional($.column_list),
      kw('AS'),
      '(', $.query, ')',
    ),

    _fullselect: $ => choice(
      $.subselect,
      $.values_clause,
      seq('(', $.query, ')'),
      $.set_operation,
    ),

    set_operation: $ => choice(
      prec.left(PREC.set_union, seq($._fullselect, choice(kw('UNION'), kw('EXCEPT')), optional(choice(kw('ALL'), kw('DISTINCT'))), $._fullselect)),
      prec.left(PREC.set_intersect, seq($._fullselect, kw('INTERSECT'), optional(choice(kw('ALL'), kw('DISTINCT'))), $._fullselect)),
    ),

    subselect: $ => prec.right(seq(
      $.select_clause,
      optional($.into_clause),
      optional($.from_clause),
      optional($.where_clause),
      optional($.group_by_clause),
      optional($.having_clause),
    )),

    select_clause: $ => seq(
      kw('SELECT'),
      optional(choice(kw('ALL'), kw('DISTINCT'))),
      commaSep1($.select_item),
    ),
    select_item: $ => choice(
      '*',
      seq($.object_name, '.*'),
      seq($.function_call, '.*', kw('AS'), '(', commaSep1($.column_definition), ')'),
      seq(field('value', $._expression), optional(seq(optional(kw('AS')), field('alias', $._name)))),
    ),

    into_clause: $ => seq(kw('INTO'), commaSep1($._target)),
    _target: $ => choice($.host_variable, $.object_name, $.array_element),

    from_clause: $ => seq(kw('FROM'), commaSep1($.table_reference)),

    table_reference: $ => choice(
      seq(
        field('table', $.object_name),
        optional($.period_specification),
        optional($.correlation),
      ),
      seq(optional(kw('LATERAL')), '(', $.query, optional($.rows_clause), ')', optional($.correlation)),
      seq(kw('TABLE'), '(', choice($.function_call, $.query), ')', optional($.correlation)),
      seq(choice(kw('FINAL'), kw('OLD'), kw('NEW')), kw('TABLE'), '(', choice($.insert_statement, $.update_statement, $.delete_statement, $.merge_statement), ')', optional($.correlation)),
      seq($.function_call, optional(kws('WITH', 'ORDINALITY')), optional($.correlation)),
      seq('(', $.table_reference, ')'),
      $.joined_table,
    ),

    joined_table: $ => prec.left(seq(
      $.table_reference,
      optional(choice(
        kw('INNER'),
        seq(choice(kw('LEFT'), kw('RIGHT'), kw('FULL')), optional(kw('OUTER'))),
        kw('CROSS'),
      )),
      kw('JOIN'),
      $.table_reference,
      optional(seq(kw('ON'), $._expression)),
    )),

    correlation: $ => seq(
      optional(kw('AS')),
      field('name', $._name),
      optional(seq('(', commaSep1(choice($._name, $.column_definition)), ')')),
    ),

    period_specification: $ => seq(
      kw('FOR'),
      optional(kws('PORTION', 'OF')),
      $.identifier,
      choice(
        seq(kws('AS', 'OF'), $._expression),
        seq(kw('FROM'), $._expression, kw('TO'), $._expression),
        seq(kw('BETWEEN'), $._expression, kw('AND'), $._expression),
      ),
    ),

    where_clause: $ => seq(kw('WHERE'), $._expression),
    group_by_clause: $ => seq(kws('GROUP', 'BY'), commaSep1(choice($._expression, seq(kws('GROUPING', 'SETS'), $.arguments)))),
    having_clause: $ => seq(kw('HAVING'), $._expression),

    order_by_clause: $ => seq(kws('ORDER', 'BY'), commaSep1($.sort_key)),
    sort_key: $ => choice(
      seq($._expression, optional(choice(kw('ASC'), kw('DESC')))),
      seq(kws('ORDER', 'OF'), $.object_name),
    ),

    fetch_clause: $ => seq(
      kw('FETCH'),
      choice(kw('FIRST'), kw('NEXT')),
      optional($._expression),
      choice(kw('ROW'), kw('ROWS')),
      kw('ONLY'),
    ),
    offset_clause: $ => seq(kw('OFFSET'), $._expression, choice(kw('ROW'), kw('ROWS'))),
    limit_clause: $ => prec.right(seq(kw('LIMIT'), $._expression, optional(seq(choice(kw('OFFSET'), ','), $._expression)))),
    // FOR UPDATE [OF columns], FOR READ ONLY, FOR FETCH ONLY
    for_clause: $ => seq(kw('FOR'), repeat1($.identifier), optional(seq(kw('OF'), commaSep1($.object_name)))),
    // WITH UR, WITH RS USE AND KEEP UPDATE LOCKS, ...
    isolation_clause: $ => seq(kw('WITH'), repeat1($.identifier)),
    optimize_clause: $ => seq(kws('OPTIMIZE', 'FOR'), $._expression, choice(kw('ROW'), kw('ROWS'))),
    queryno_clause: $ => seq(kw('QUERYNO'), $.number),
    skip_locked_clause: $ => kws('SKIP', 'LOCKED', 'DATA'),

    values_clause: $ => prec.right(seq(kw('VALUES'), commaSep1($._expression), optional($.into_clause))),

    // ---- data change ---------------------------------------------------------

    insert_statement: $ => seq(
      kws('INSERT', 'INTO'),
      field('table', $.object_name),
      optional($.column_list),
      optional($.include_columns),
      optional(seq(kw('OVERRIDING'), $.identifier, kw('VALUE'))),
      $.query,
      optional($.rows_clause),
      optional($.atomic_clause),
    ),
    // [NOT] ATOMIC [CONTINUE ON SQLEXCEPTION]
    // One token for NOT ATOMIC: a lone NOT after an expression would start NOT LIKE/IN/BETWEEN.
    atomic_clause: $ => prec.right(seq(choice(kw('ATOMIC'), alias(new RegExp('not' + ws + 'atomic', 'i'), 'NOT ATOMIC')), repeat($.identifier))),
    // FOR n ROWS: multi-row INSERT and MERGE, rowset FETCH.
    rows_clause: $ => seq(kw('FOR'), $._expression, choice(kw('ROW'), kw('ROWS'))),
    include_columns: $ => seq(kw('INCLUDE'), '(', commaSep1($.column_definition), ')'),

    update_statement: $ => seq(
      kw('UPDATE'),
      field('table', $.object_name),
      optional($.period_specification),
      optional($.correlation),
      optional($.include_columns),
      $.set_clause,
      optional(choice($.where_clause, $.current_of)),
      repeat(choice($.isolation_clause, $.queryno_clause, $.skip_locked_clause, $.fetch_clause)),
    ),
    set_clause: $ => seq(kw('SET'), commaSep1($.assignment)),
    assignment: $ => seq(
      field('left', choice($._target, seq('(', commaSep1($._target), ')'))),
      '=',
      field('right', $._expression),
    ),
    current_of: $ => seq(
      kws('WHERE', 'CURRENT', 'OF'),
      field('cursor', $.identifier),
      optional(seq(kws('FOR', 'ROW'), $._expression, kws('OF', 'ROWSET'))),
    ),

    delete_statement: $ => seq(
      kw('DELETE'),
      optional(kw('FROM')),
      field('table', $.object_name),
      optional($.period_specification),
      optional($.correlation),
      optional(seq($.include_columns, optional($.set_clause))),
      optional(choice($.where_clause, $.current_of)),
      repeat(choice($.isolation_clause, $.queryno_clause, $.skip_locked_clause, $.fetch_clause)),
    ),

    merge_statement: $ => seq(
      kws('MERGE', 'INTO'),
      field('table', $.object_name),
      optional($.correlation),
      optional($.include_columns),
      kw('USING'),
      field('source', $.table_reference),
      kw('ON'),
      $._expression,
      repeat1($.merge_when),
      optional(kws('ELSE', 'IGNORE')),
      optional($.atomic_clause),
      optional($.queryno_clause),
    ),
    merge_when: $ => prec.right(seq(
      kw('WHEN'),
      optional(kw('NOT')),
      kw('MATCHED'),
      optional(seq(kw('AND'), $._expression)),
      kw('THEN'),
      choice(
        seq(kw('UPDATE'), $.set_clause),
        kw('DELETE'),
        seq(kw('INSERT'), optional($.column_list), $.values_clause),
        seq(kw('SIGNAL'), repeat1($._soup_token)),
      ),
    )),

    // ---- cursors -------------------------------------------------------------

    declare_cursor_statement: $ => seq(
      kw('DECLARE'),
      field('name', $.identifier),
      repeat(choice(kw('NO'), kw('SCROLL'), kw('ASENSITIVE'), kw('INSENSITIVE'), kw('SENSITIVE'), kw('STATIC'), kw('DYNAMIC'))),
      kw('CURSOR'),
      repeat(choice(kw('WITH'), kw('WITHOUT'), $.identifier)),
      kw('FOR'),
      choice($.query, field('statement', choice($.identifier, $.host_variable))),
    ),

    open_statement: $ => seq(kw('OPEN'), field('cursor', $.identifier), repeat($._soup_token)),
    close_statement: $ => seq(kw('CLOSE'), field('cursor', $.identifier), repeat($._soup_token)),
    fetch_statement: $ => seq(
      kw('FETCH'),
      repeat($._fetch_orientation),
      optional(kw('FROM')),
      field('cursor', $.identifier),
      optional($.rows_clause),
      optional(choice($.into_clause, seq(choice(kw('INTO'), kw('USING')), kw('DESCRIPTOR'), $._target))),
    ),
    _fetch_orientation: $ => choice($.identifier, $.number, $.host_variable, '+', '-'),

    // ---- DDL -----------------------------------------------------------------

    // DECLARE TABLE, as written by DCLGEN.
    declare_table_statement: $ => seq(
      kw('DECLARE'),
      field('name', $.object_name),
      kw('TABLE'),
      $.table_elements,
    ),

    create_table_statement: $ => seq(
      kw('CREATE'),
      optional(kws('GLOBAL', 'TEMPORARY')),
      kw('TABLE'),
      field('name', $.object_name),
      choice(
        $.table_elements,
        seq(kw('LIKE'), field('like', $.object_name)),
        seq(optional($.column_list), kw('AS'), '(', $.query, ')'),
      ),
      repeat($._soup_token),
    ),

    table_elements: $ => seq('(', commaSep1(choice($.column_definition, $.table_constraint)), ')'),

    column_definition: $ => seq(
      field('name', $._name),
      field('type', $.data_type),
      repeat($._element_token),
    ),

    table_constraint: $ => seq(
      choice(kw('CONSTRAINT'), kw('PRIMARY'), kw('UNIQUE'), kw('FOREIGN'), kw('CHECK'), kw('PERIOD')),
      repeat($._element_token),
    ),

    _element_token: $ => choice($._soup_token_no_comma, $.references_clause),

    references_clause: $ => prec.right(seq(kw('REFERENCES'), field('table', $.object_name), optional(alias($._soup_group, $.group)))),

    data_type: $ => prec.right(seq($.object_name, optional($.type_parameters))),
    // CHAR(8), DECIMAL(15, 2), BLOB(1M)
    type_parameters: $ => seq('(', repeat1(choice($.number, $.identifier, ',')), ')'),

    create_view_statement: $ => seq(
      kw('CREATE'),
      optional(kws('OR', 'REPLACE')),
      kw('VIEW'),
      field('name', $.object_name),
      optional($.column_list),
      kw('AS'),
      $.query,
    ),

    create_index_statement: $ => seq(
      kw('CREATE'),
      optional(seq(kw('UNIQUE'), optional(kws('WHERE', 'NOT', 'NULL')))),
      kw('INDEX'),
      field('name', $.object_name),
      kw('ON'),
      field('table', $.object_name),
      repeat($._soup_token),
    ),

    create_alias_statement: $ => seq(
      kw('CREATE'),
      optional(kw('PUBLIC')),
      choice(kw('ALIAS'), kw('SYNONYM')),
      field('name', $.object_name),
      kw('FOR'),
      optional(choice(kw('TABLE'), kw('SEQUENCE'))),
      field('target', $.object_name),
    ),

    // ---- calls and includes ---------------------------------------------------

    call_statement: $ => seq(
      kw('CALL'),
      field('procedure', choice($.object_name, $.host_variable)),
      optional(choice($.arguments, seq(kws('USING', 'DESCRIPTOR'), $._target))),
    ),

    include_statement: $ => seq(kw('INCLUDE'), field('member', $.identifier)),

    // ---- expressions ---------------------------------------------------------

    _expression: $ => choice(
      $._primary,
      $.unary_expression,
      $.binary_expression,
      $.comparison_expression,
      $.between_expression,
      $.in_expression,
      $.like_expression,
      $.is_expression,
      $.not_expression,
      $.labeled_duration,
      $.time_zone_expression,
    ),

    _primary: $ => choice(
      $.number,
      $.string,
      $.null,
      $.host_variable,
      $.parameter_marker,
      $.object_name,
      $.function_call,
      $.special_register,
      $.datetime_literal,
      $.array_constructor,
      $.case_expression,
      $.exists_expression,
      $.sequence_reference,
      $.subquery,
      $.parenthesized_expression,
      $.row_value,
      $.array_element,
      $.row_change_expression,
    ),

    null: _ => kw('NULL'),
    parameter_marker: _ => '?',

    parenthesized_expression: $ => seq('(', $._expression, ')'),
    row_value: $ => seq('(', $._expression, ',', commaSep1($._expression), ')'),
    subquery: $ => seq('(', $.query, ')'),

    function_call: $ => prec(1, seq(
      field('name', $.object_name),
      $.arguments,
      optional(seq(kws('WITHIN', 'GROUP'), $.arguments)),
      optional(seq(kw('OVER'), $.arguments)),
    )),
    // Arguments stay a token list: CAST(x AS CHAR(8) FOR BIT DATA), TRIM(LEADING ' ' FROM x),
    // XMLELEMENT(NAME "x", ...) and window specifications all fit without a rule each.
    arguments: $ => seq('(', repeat($._soup_token), ')'),

    special_register: $ => prec.right(choice(
      seq(kw('CURRENT'), $.identifier, optional($.type_parameters), optional(alias($._with_time_zone, 'WITH TIME ZONE'))),
      // Registers of several words are one token each: as keywords, they cost a tenth of the
      // parse speed. One token also keeps SESSION and CLIENT usable as plain names.
      alias(new RegExp('current' + ws + '(' + [
        'application' + ws + '(compatibility|encoding' + ws + 'scheme)',
        'debug' + ws + 'mode',
        'decfloat' + ws + 'rounding' + ws + 'mode',
        'explain' + ws + 'mode',
        'locale' + ws + 'lc_ctype',
        'lock' + ws + 'timeout',
        'maintained' + ws + '(table' + ws + ')?types(' + ws + 'for' + ws + 'optimization)?',
        'optimization' + ws + 'hint',
        'package' + ws + 'path',
        'query' + ws + 'acceleration(' + ws + 'waitfordata)?',
        'refresh' + ws + 'age',
        'routine' + ws + 'version',
        'temporal' + ws + '(business_time|system_time)',
        'time' + ws + 'zone',
      ].join('|') + ')', 'i'), 'CURRENT'),
      alias(new RegExp('session' + ws + 'time' + space + '*zone', 'i'), 'SESSION TIME ZONE'),
      alias(new RegExp('client' + ws + '(acctng|applname|userid|wrkstnname)', 'i'), 'CLIENT'),
    )),
    // One token: WITH alone continues with DEFAULT, UR, CHECK OPTION and more.
    _with_time_zone: _ => new RegExp('(with|without)' + ws + 'time' + ws + 'zone', 'i'),

    // DATE '2024-01-31', TIME '10.30.00', TIMESTAMP '...'. One token, so DATE(x) stays a function call.
    datetime_literal: _ => new RegExp('(date|time|timestamp)' + space + '*' + stringBody, 'i'),

    array_constructor: $ => seq(
      alias(new RegExp('array' + space + '*(\\[|\\?\\?\\()', 'i'), 'ARRAY['),
      optional(choice(commaSep1($._expression), $.query)),
      $._right_bracket,
    ),

    sequence_reference: $ => seq(
      choice(seq(choice(kw('NEXT'), kw('PREVIOUS')), kw('VALUE')), kw('NEXTVAL'), kw('PREVVAL')),
      kw('FOR'),
      field('sequence', $.object_name),
    ),

    array_element: $ => seq($.object_name, $._left_bracket, $._expression, $._right_bracket),
    // ??( and ??) are trigraphs for brackets in CCSIDs without them.
    _left_bracket: _ => choice('[', '??('),
    _right_bracket: _ => choice(']', '??)'),

    row_change_expression: $ => seq(kws('ROW', 'CHANGE'), $.identifier, kw('FOR'), $.object_name),

    time_zone_expression: $ => prec.left(PREC.duration, seq(
      $._expression,
      kw('AT'),
      choice(kw('LOCAL'), seq(kws('TIME', 'ZONE'), $._primary)),
    )),

    case_expression: $ => seq(
      kw('CASE'),
      optional($._expression),
      repeat1(seq(kw('WHEN'), $._expression, kw('THEN'), $._expression)),
      optional(seq(kw('ELSE'), $._expression)),
      kw('END'),
    ),

    exists_expression: $ => seq(kw('EXISTS'), $.subquery),

    unary_expression: $ => prec(PREC.unary, seq(choice('+', '-'), $._expression)),

    not_expression: $ => prec(PREC.not, seq(kw('NOT'), $._expression)),

    binary_expression: $ => choice(
      prec.left(PREC.or, seq($._expression, kw('OR'), $._expression)),
      prec.left(PREC.and, seq($._expression, kw('AND'), $._expression)),
      prec.left(PREC.additive, seq($._expression, choice('+', '-', '||', kw('CONCAT')), $._expression)),
      prec.left(PREC.multiplicative, seq($._expression, choice('*', '/'), $._expression)),
    ),

    comparison_expression: $ => prec.left(PREC.predicate, seq(
      $._expression,
      $._comparison_operator,
      choice(
        $._expression,
        seq(choice(kw('ANY'), kw('SOME'), kw('ALL')), $.subquery),
      ),
    )),
    _comparison_operator: _ => choice('=', '<>', '¬=', '!=', '^=', '<', '>', '<=', '>=', '¬<', '¬>', '!<', '!>', '^<', '^>'),

    between_expression: $ => prec.left(PREC.predicate, seq(
      $._expression, optional(kw('NOT')), kw('BETWEEN'), $._expression, kw('AND'), $._expression,
    )),

    in_expression: $ => prec.left(PREC.predicate, seq(
      $._expression, optional(kw('NOT')), kw('IN'),
      choice($.subquery, $.parenthesized_expression, $.row_value, $._primary),
    )),

    like_expression: $ => prec.left(PREC.predicate, seq(
      $._expression, optional(kw('NOT')), kw('LIKE'), $._expression,
      optional(seq(kw('ESCAPE'), $._expression)),
    )),

    is_expression: $ => prec.left(PREC.predicate, seq(
      $._expression, kw('IS'), optional(kw('NOT')),
      choice(kw('NULL'), seq(kws('DISTINCT', 'FROM'), $._expression)),
    )),

    labeled_duration: $ => prec(PREC.duration, seq($._expression, choice(
      kw('YEAR'), kw('YEARS'), kw('MONTH'), kw('MONTHS'), kw('DAY'), kw('DAYS'),
      kw('HOUR'), kw('HOURS'), kw('MINUTE'), kw('MINUTES'), kw('SECOND'), kw('SECONDS'),
      kw('MICROSECOND'), kw('MICROSECONDS'),
    ))),

    // ---- token lists ---------------------------------------------------------

    // The lenient part: the tokens of a statement or clause this grammar does not
    // structure. Parenthesised queries inside them still parse as queries.
    _soup_token: $ => choice($._soup_token_no_comma, ','),
    _soup_token_no_comma: $ => choice(
      $.identifier,
      $.quoted_identifier,
      $.number,
      $.string,
      $.host_variable,
      $.parameter_marker,
      $.subquery,
      alias($._soup_group, $.group),
      alias($._bracket_group, $.group),
      alias(/[=<>¬!^|+\-*\/.:&%]+|=>/, $.operator),
    ),
    _soup_group: $ => seq('(', repeat($._soup_token), ')'),
    _bracket_group: $ => seq($._left_bracket, repeat($._soup_token), $._right_bracket),
    _statement_token: $ => choice($._soup_token, $.compound_block),

    // SQL PL bodies (CREATE PROCEDURE ... BEGIN ...; ...; END) contain ';'.
    compound_block: $ => seq(
      kw('BEGIN'),
      repeat(choice($._statement_token, ';', alias($._end_compound, $.identifier), $.compound_case)),
      kw('END'),
    ),
    compound_case: $ => seq(
      kw('CASE'),
      repeat(choice($._statement_token, ';', alias($._end_compound, $.identifier), $.compound_case)),
      choice(kw('END'), alias(new RegExp('end' + ws + 'case', 'i'), 'END CASE')),
    ),
    _end_compound: _ => new RegExp('end' + ws + '(if|loop|while|repeat|for)', 'i'),

    // ---- names and literals --------------------------------------------------

    object_name: $ => sep1($._name, '.'),
    column_list: $ => seq('(', commaSep1($._name), ')'),
    _name: $ => choice($.identifier, $.quoted_identifier),

    identifier: _ => /[\p{L}@#$_][\p{L}\p{N}@#$_]*/,
    quoted_identifier: _ => /"([^"]|"")*"/,

    host_variable: $ => prec.right(seq(
      $._host_variable_name,
      optional(seq(optional(kw('INDICATOR')), alias($._host_variable_name, $.indicator))),
    )),
    _host_variable_name: _ => /:[A-Za-z@#$_][A-Za-z0-9@#$_\-]*(\.[A-Za-z@#$_][A-Za-z0-9@#$_\-]*)*/,

    number: _ => /(\d+(\.\d*)?|\.\d+)([Ee][+-]?\d+)?/,
    string: _ => new RegExp('([GgNnXx]|[Uu][Xx]|[Bb][Xx]|[Gg][Xx])?' + stringBody),

    comment: _ => token(choice(/--[^\r\n]*/, /\/\*[^*]*\*+([^/*][^*]*\*+)*\//)),
  },
});
