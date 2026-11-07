'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lexer = require('../server/c-lexer');
const analyze = require('../server/analyze');
const symbols = require('../server/symbols');
const build = require('../server/build');
const debug = require('../server/debug');

const codes = (result, code) => result.diagnostics.filter((d) => d.code === code).length;

test('词法分析：注释、字符串、数字、预处理与运算符', () => {
  const src = '#include <stdio.h>\n/* block\ncomment */\nint x = 0x1F + 2.5f; // tail\nchar *s = "a\\"b";\n';
  const { tokens } = lexer.tokenize(src);
  assert.ok(tokens.some((t) => t.type === 'preproc' && t.text.includes('stdio.h')));
  assert.ok(tokens.some((t) => t.type === 'comment' && t.text.includes('block')));
  assert.ok(tokens.some((t) => t.type === 'number' && t.text === '0x1F'));
  assert.ok(tokens.some((t) => t.type === 'string' && t.text.includes('a\\"b')));
  assert.equal(lexer.tokenize(src).diagnostics.length, 0);
});

test('词法分析：未闭合注释与字符串产生错误', () => {
  const comment = analyze.analyze('int main() { /* oops\n return 0; }\n');
  assert.ok(codes(comment, 'C001') > 0, '应检出未闭合块注释');
  const literal = analyze.analyze('int main() { char *s = "abc;\n return 0; }\n');
  assert.ok(codes(literal, 'C002') > 0, '应检出未闭合字符串');
});

test('诊断：括号不匹配、全角标点、危险函数与条件赋值', () => {
  const src = [
    '#include <stdio.h>',
    'int main(void) {',
    '    char buf[8]；',
    '    if (x = 1) { gets(buf); })',
    '    return 0;'
  ].join('\n');
  const r = analyze.analyze(src);
  assert.ok(codes(r, 'C010') > 0, '括号不匹配');
  assert.ok(codes(r, 'C020') > 0, '全角分号');
  assert.ok(codes(r, 'C030') > 0, 'gets 已废弃');
  assert.ok(codes(r, 'C040') > 0, '条件中的赋值');
});

test('诊断：printf 格式串与参数数量不一致', () => {
  const bad = analyze.analyze('int main(void){ printf("%d %s\\n", 1); return 0; }');
  assert.ok(codes(bad, 'C050') > 0);
  const good = analyze.analyze('int main(void){ printf("%d %s\\n", 1, "x"); return 0; }');
  assert.equal(codes(good, 'C050'), 0);
  const percent = analyze.analyze('int main(void){ printf("100%% done\\n"); return 0; }');
  assert.equal(codes(percent, 'C050'), 0);
});

test('诊断：缺失分号提示且不误报代码块结束', () => {
  const missing = analyze.analyze('int main(void) {\n    int x = 1\n    printf("%d", x);\n    return 0;\n}\n');
  assert.ok(codes(missing, 'C060') > 0);
  const clean = [
    '#include <stdio.h>',
    'int main(void) {',
    '    int sum = 0;',
    '    for (int i = 1; i <= 10; i++) {',
    '        sum += i;',
    '    }',
    '    printf("%d\\n", sum);',
    '    return 0;',
    '}',
    ''
  ].join('\n');
  assert.equal(analyze.analyze(clean).diagnostics.length, 0, '标准示例不应产生诊断');
});

test('符号大纲：函数、结构体、宏、包含，且函数内调用不算原型', () => {
  const src = [
    '#include <stdio.h>',
    '#define MAX 10',
    'typedef struct Node { int value; } Node;',
    'static int add(int a, int b);',
    'int main(void) {',
    '    printf("%d\\n", add(1, 2));',
    '    return 0;',
    '}'
  ].join('\n');
  const result = symbols.outline(src);
  const kinds = result.symbols.map((s) => s.kind + ':' + s.name);
  assert.ok(kinds.includes('function:main'));
  assert.ok(kinds.includes('prototype:add'));
  assert.ok(kinds.includes('macro:MAX'));
  assert.ok(kinds.includes('include:stdio.h'));
  assert.ok(!kinds.includes('prototype:printf'), '函数体内的调用不应被识别为原型');
  assert.equal(result.metrics.functions, 1);
  assert.ok(result.metrics.lines >= 8);
});

test('格式化：按大括号层级重排缩进', () => {
  const src = 'int main(void) {\nint x = 1;\nif (x) {\nx++;\n}\nreturn 0;\n}\n';
  const out = lexer.format(src, { tabSize: 4, insertSpaces: true });
  assert.ok(out.includes('\n    int x = 1;'));
  assert.ok(out.includes('\n        x++;'));
  assert.ok(out.includes('\n    return 0;'));
});

test('编译器诊断解析：gcc / clang / MSVC / 链接错误', () => {
  const text = [
    'main.c:5:12: error: expected \';\' before \'return\'',
    'main.c:9:3: warning: unused variable \'x\' [-Wunused-variable]',
    'src/util.c:3:1: fatal error: missing.h: No such file or directory',
    'C:\\proj\\a.c(12): error C2143: syntax error',
    'collect2: error: ld returned 1 exit status'
  ].join('\n');
  const list = build.parseDiagnostics(text, 'C:/proj');
  assert.equal(list.filter((d) => d.severity === 'error' && d.code !== 'LNK').length, 3);
  assert.equal(list.filter((d) => d.code === 'W:unused-variable').length, 1);
  assert.ok(list.some((d) => d.file === 'src/util.c' && d.line === 3));
  assert.ok(list.some((d) => d.code === 'LNK'));
});

test('命令参数拆分支持引号', () => {
  assert.deepEqual(build.splitArgs('-I"my dir" -O2 -DFOO=1'), ['-Imy dir', '-O2', '-DFOO=1']);
});

test('gdb MI 值解析：字符串、元组与列表', () => {
  assert.equal(debug.parseValue('"hello\\nworld"', { i: 0 }), 'hello\nworld');
  const tuple = debug.parseValue('{level="0",func="main",line="12"}', { i: 0 });
  assert.equal(tuple.func, 'main');
  assert.equal(tuple.line, '12');
  const record = debug.parseRecord('stopped,reason="breakpoint-hit",frame={addr="0x1",func="main",line="7"}');
  assert.equal(record.name, 'stopped');
  assert.equal(record.result.reason, 'breakpoint-hit');
  assert.equal(record.result.frame.line, '7');
});
