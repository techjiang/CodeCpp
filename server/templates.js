'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const TEMPLATES = [
  {
    id: 'hello',
    name: 'Hello World',
    description: '单文件入门程序，体验编辑 → 编译 → 运行 → 调试全流程',
    icon: 'file',
    files: {
      'main.c': `#include <stdio.h>

int main(void) {
    const char *greeting = "Hello, CodeCpp!";
    printf("%s\\n", greeting);

    int sum = 0;
    for (int i = 1; i <= 10; i++) {
        sum += i;
    }
    printf("1 + 2 + ... + 10 = %d\\n", sum);
    return 0;
}
`
    }
  },
  {
    id: 'multi',
    name: '多文件项目',
    description: '头文件 + 多个源文件 + Makefile，演示工程化结构与增量构建',
    icon: 'folder',
    files: {
      'include/calc.h': `#ifndef CALC_H
#define CALC_H

int add(int a, int b);
int factorial(int n);

#endif
`,
      'src/calc.c': `#include "calc.h"

int add(int a, int b) {
    return a + b;
}

int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}
`,
      'src/main.c': `#include <stdio.h>
#include "calc.h"

int main(void) {
    printf("3 + 4 = %d\\n", add(3, 4));
    printf("5! = %d\\n", factorial(5));
    return 0;
}
`,
      'Makefile': `CC ?= gcc
CFLAGS ?= -std=c11 -Wall -Wextra -g -O0
INCLUDES := -Iinclude
SRC := $(wildcard src/*.c)
OBJ := $(SRC:.c=.o)

all: app

app: $(OBJ)
\t$(CC) $(CFLAGS) $(OBJ) -o app $(LDFLAGS)

%.o: %.c
\t$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

clean:
\trm -f $(OBJ) app app.exe

.PHONY: all clean
`
    }
  },
  {
    id: 'struct',
    name: '数据结构示例',
    description: '结构体、链表与动态内存管理，包含调试断点演示',
    icon: 'list',
    files: {
      'list.c': `#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int value;
    struct Node *next;
} Node;

static Node *push(Node *head, int value) {
    Node *node = malloc(sizeof(Node));
    if (!node) {
        fprintf(stderr, "内存分配失败\\n");
        exit(EXIT_FAILURE);
    }
    node->value = value;
    node->next = head;
    return node;
}

static void print_list(const Node *head) {
    for (const Node *p = head; p != NULL; p = p->next) {
        printf("%d ", p->value);
    }
    printf("\\n");
}

static void free_list(Node *head) {
    while (head) {
        Node *next = head->next;
        free(head);
        head = next;
    }
}

int main(void) {
    Node *head = NULL;
    for (int i = 1; i <= 5; i++) {
        head = push(head, i * 10);
    }
    print_list(head);
    free_list(head);
    return 0;
}
`
    }
  },
  {
    id: 'cmake',
    name: 'CMake 工程',
    description: '标准 CMakeLists.txt 布局，适合中大型 C 工程',
    icon: 'build',
    files: {
      'CMakeLists.txt': `cmake_minimum_required(VERSION 3.10)
project(CodeCppDemo LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra)

add_executable(app src/main.c)
`,
      'src/main.c': `#include <stdio.h>

int main(void) {
    puts("CMake 工程已就绪");
    return 0;
}
`
    }
  }
];

function list() {
  return TEMPLATES.map(({ files, ...meta }) => Object.assign({}, meta, { fileCount: Object.keys(files).length }));
}

function create(id, targetDir) {
  const tpl = TEMPLATES.find((t) => t.id === id);
  if (!tpl) throw new Error('未知模板：' + id);
  const base = paths.resolveSafe(targetDir || '.');
  const created = [];
  for (const [rel, content] of Object.entries(tpl.files)) {
    const dest = paths.resolveSafe(path.join(base, rel));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, content, 'utf8');
      created.push(paths.relative(dest));
    }
  }
  return { name: tpl.name, created, skipped: Object.keys(tpl.files).length - created.length };
}

function seedWorkspace() {
  const base = paths.root();
  const entries = fs.readdirSync(base);
  if (entries.length > 0) return false;
  create('hello', '.');
  fs.writeFileSync(path.join(base, 'README.md'),
    '# CodeCpp 工作区\n\n这里是 CodeCpp 的默认工作区。使用左侧「资源管理器」创建文件，或从「项目模板」一键生成示例工程。\n', 'utf8');
  return true;
}

module.exports = { TEMPLATES, list, create, seedWorkspace };
