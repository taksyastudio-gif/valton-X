import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LONG_RUNNING_TESTS = new Set([
  'C timeout',
  'C stopped by Ctrl-C',
  'Python EOF',
]);
const LARGE_C_INPUT = Array.from(
  { length: 300 },
  (_, index) => `${index + 1}\n`,
).join('');
const LARGE_C_INPUT_SUM = (300 * 301) / 2;
const LARGE_PYTHON_INPUT = `${Array.from(
  { length: 500 },
  (_, index) => index % 10,
).join(' ')}\n`;

const tests = [
  {
    name: 'C stdout',
    file: 'main.c',
    code: '#include <stdio.h>\nint main(void) { printf("c-ok\\n"); return 0; }',
    expected: 'c-ok',
  },
  {
    name: 'C multiple input lines',
    file: 'main.c',
    code: '#include <stdio.h>\nint main(void) { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a + b); return 0; }',
    expected: '7',
    input: '3\n4\n',
  },
  {
    name: 'C large queued input',
    file: 'main.c',
    code: '#include <stdio.h>\nint main(void) { int value, sum = 0; for (int i = 0; i < 300; i++) { if (scanf("%d", &value) != 1) return 2; sum += value; } printf("%d\\n", sum); return 0; }',
    expected: String(LARGE_C_INPUT_SUM),
    input: LARGE_C_INPUT,
  },
  {
    name: 'C UTF-8 output',
    file: 'main.c',
    code: '#include <stdio.h>\nint main(void) { printf("UTF-8: café 世界 🚀\\n"); return 0; }',
    expected: 'UTF-8: café 世界 🚀',
  },
  {
    name: 'Python stdout',
    file: 'main.py',
    code: 'print("python-ok")\nfor i in range(3):\n    print(i)',
    expected: 'python-ok',
  },
  {
    name: 'Python input',
    file: 'main.py',
    code: 'name = input("Name: ")\nprint("Hello " + name)',
    expected: 'Hello Valton',
    input: 'Valton\n',
  },
  {
    name: 'Python large input',
    file: 'main.py',
    code: 'values = input().split()\nprint("large-count", len(values))',
    expected: 'large-count 500',
    input: LARGE_PYTHON_INPUT,
  },
  {
    name: 'Python UTF-8 output',
    file: 'main.py',
    code: 'print("UTF-8: café 世界 🚀")',
    expected: 'UTF-8: café 世界 🚀',
  },
  {
    name: 'Python offline SQLite',
    file: 'main.py',
    code: 'import sqlite3\nconnection = sqlite3.connect(":memory:")\nconnection.execute("create table items (value integer)")\nconnection.executemany("insert into items values (?)", [(1,), (2,)])\ncount = connection.execute("select count(*) from items").fetchone()[0]\nprint("sqlite-ok", count)\nconnection.close()',
    expected: 'sqlite-ok 2',
    timeout: 90000,
  },
  {
    name: 'Python syntax error',
    file: 'main.py',
    code: 'for i in range(3)\n    print(i)',
    expected: 'syntax',
  },
  {
    name: 'C output limit',
    file: 'main.c',
    code: '#include <stdio.h>\nint main(void) { for (int i = 0; i < 350000; i++) puts("output-limit-check"); return 0; }',
    expected: 'output limit',
    timeout: 90000,
    bodyExpected: true,
  },
  {
    name: 'C stopped by stop button',
    file: 'main.c',
    code: 'int main(void) { for (;;) {} }',
    expected: 'Execution stopped',
    action: 'stop',
    timeout: 10000,
    bodyExpected: true,
  },
  {
    name: 'C timeout',
    file: 'main.c',
    code: 'int main(void) { for (;;) {} }',
    expected: 'timed out',
    action: 'timeout',
    timeout: 40000,
    bodyExpected: true,
  },
  {
    name: 'C stopped by Ctrl-C',
    file: 'main.c',
    code: 'int main(void) { for (;;) {} }',
    expected: 'Execution stopped',
    action: 'ctrl-c',
    timeout: 10000,
    bodyExpected: true,
  },
  {
    name: 'Python EOF',
    file: 'main.py',
    code: 'value = input()\nprint("eof-ok" if value == "" else "unexpected")',
    expected: 'eof-ok',
    action: 'eof',
    timeout: 30000,
    bodyExpected: true,
  },
];

const getTerminalText = async (page) =>
  page.$eval('.xterm-rows', (element) => element.innerText);

const selectFile = async (page, fileName) => {
  const file = await page.$(`span[title="${fileName}"]`);
  if (!file) {
    throw new Error(`File explorer entry not found: ${fileName}`);
  }
  await file.click();
  await sleep(300);
};

const setEditorCode = async (page, code) => {
  await page.waitForFunction(
    () => Boolean(window.monaco?.editor?.getEditors?.().length),
  );
  await page.evaluate((value) => {
    const editor = window.monaco.editor.getEditors()[0];
    editor.setValue(value);
    editor.focus();
  }, code);
};

const clearTerminal = async (page) => {
  const buttons = await page.$$(
    'button[aria-label="Clear terminal"]',
  );
  await buttons[0].click();
};

const closeErrorModal = async (page) => {
  const closeButton = await page.$(
    'dialog[open] button[aria-label="Close error modal"]',
  );
  if (closeButton) {
    await closeButton.click();
    await sleep(100);
  }
};

const runCode = async (page) => {
  await page.locator('button[aria-label="Run code"]').click();
};

const sendTerminalInput = async (page, input) => {
  const textarea = await page.$('.xterm-helper-textarea');
  if (!textarea) {
    throw new Error('xterm input element not found');
  }
  await textarea.click();
  await page.keyboard.type(input);
};

const waitForRunning = async (page) => {
  await page.waitForSelector(
    'button[aria-label="Stop execution"]',
    { timeout: 30000 },
  );
};

const run = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    channel: 'chrome',
    protocolTimeout: 120000,
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    let page = await browser.newPage();
    await page.goto('http://localhost:5173', {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('.xterm-rows');

    const results = [];
    for (const test of tests) {
      await closeErrorModal(page);
      await clearTerminal(page);
      await selectFile(page, test.file);
      await setEditorCode(page, test.code);
      await runCode(page);

      if (test.input) {
        await sleep(test.file === 'main.py' ? 8000 : 3000);
        await sendTerminalInput(page, test.input);
      }

      if (test.action === 'stop') {
        await waitForRunning(page);
        await sleep(1000);
        await page.locator(
          'button[aria-label="Stop execution"]',
        ).click();
      }

      if (test.action === 'eof') {
        await sleep(8000);
        const textarea = await page.$('.xterm-helper-textarea');
        await textarea.click();
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyD');
        await page.keyboard.up('Control');
      }

      if (test.action === 'ctrl-c') {
        await waitForRunning(page);
        await sleep(1000);
        const textarea = await page.$('.xterm-helper-textarea');
        await textarea.click();
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyC');
        await page.keyboard.up('Control');
      }

      try {
        await page.waitForFunction(
          (expected, isSyntaxTest, useBody) => {
            if (isSyntaxTest) {
              return document.body.innerText.includes(
                "Doctor's full check-up",
              ) &&
                document.body.innerText
                  .toLowerCase()
                  .includes(expected.toLowerCase());
            }
            const text = useBody
              ? document.body.innerText
              : document.querySelector('.xterm-rows')?.innerText;
            return text?.toLowerCase().includes(
              expected.toLowerCase(),
            );
          },
          { timeout: test.timeout ?? 60000 },
          test.expected,
          test.name === 'Python syntax error',
          test.bodyExpected ?? false,
        );
      } catch (error) {
        try {
          const labReportButton = await page.$(
            'button[aria-controls="error-doctor-raw-log"]',
          );
          if (labReportButton) {
            await labReportButton.click();
          }
          console.log(
            `Output for ${test.name}:`,
            (await page.evaluate(() => document.body.innerText)).slice(-1200),
          );
        } catch {
          console.log(`Output for ${test.name}: page detached during assertion`);
        }
        throw error;
      }

      const output = await getTerminalText(page);
      const passed = test.name === 'Python syntax error'
        ? (await page.evaluate(() =>
            document.body.innerText.includes("Doctor's full check-up") &&
            document.body.innerText.toLowerCase().includes(
              'syntax',
            )))
        : test.bodyExpected
          ? (await page.evaluate((expected) =>
              document.body.innerText.toLowerCase().includes(
                expected.toLowerCase(),
              ), test.expected))
          : output.includes(test.expected);
      if (!passed) {
        console.log(`Terminal output for ${test.name}:`, output);
      }
      results.push({ name: test.name, passed });
      console.log(`${passed ? 'PASS' : 'FAIL'} ${test.name}`);

      if (LONG_RUNNING_TESTS.has(test.name)) {
        await page.close();
        page = await browser.newPage();
        await page.goto('http://localhost:5173', {
          waitUntil: 'networkidle0',
        });
        await page.waitForSelector('.xterm-rows');
      }
    }

    const failed = results.filter((result) => !result.passed);
    console.log(`\n${results.length - failed.length}/${results.length} regression tests passed`);
    if (failed.length > 0) {
      throw new Error(failed.map((result) => result.name).join(', '));
    }
  } finally {
    await browser.close();
  }
};

await run();
