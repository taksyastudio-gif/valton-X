const { execFileSync } = require('node:child_process');

const endpoint = process.argv[2] || 'http://localhost:3003/api/execute';
const helloSource = '#include <stdio.h>\nint main(){\n    printf("Hello forgeByteX!\\n");\n    return 0;\n}\n';
const stdinSource = '#include <stdio.h>\nint main(){\n    char name[100];\n    scanf("%99s", name);\n    printf("Hello %s!\\n", name);\n    return 0;\n}\n';
const compileErrorSource = '#include <stdio.h>\nint main(){\n    printf("oops\\n";\n    return 0;\n}\n';
const runtimeErrorSource = '#include <stdio.h>\nint main(){\n    int *value = 0;\n    return *value;\n}\n';
const timeoutSource = '#include <stdio.h>\nint main(){\n    while (1) {}\n    return 0;\n}\n';

async function request(name, payload) {
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  return { name, status: response.status, elapsedMs: Date.now() - startedAt, body };
}

function processSnapshot() {
  try {
    const output = execFileSync('tasklist', ['/fi', 'imagename eq main.exe', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
    return output.trim();
  } catch (error) {
    return `tasklist failed: ${error.message}`;
  }
}

(async () => {
  const results = [];
  results.push(await request('hello', { requestId: 'proof-hello', language: 'c', source: helloSource, stdin: '', timeoutMs: 10000 }));
  results.push(await request('stdin', { requestId: 'proof-stdin', language: 'c', source: stdinSource, stdin: 'Alice\n', timeoutMs: 10000 }));
  results.push(await request('compile-error', { requestId: 'proof-compile-error', language: 'c', source: compileErrorSource, stdin: '', timeoutMs: 10000 }));
  results.push(await request('runtime-error', { requestId: 'proof-runtime-error', language: 'c', source: runtimeErrorSource, stdin: '', timeoutMs: 10000 }));
  results.push(await request('timeout', { requestId: 'proof-timeout', language: 'c', source: timeoutSource, stdin: '', timeoutMs: 1000 }));

  for (let index = 1; index <= 5; index += 1) {
    results.push(await request(`repeat-${index}`, { requestId: `proof-repeat-${index}`, language: 'c', source: helloSource, stdin: '', timeoutMs: 10000 }));
  }

  console.log(JSON.stringify({ results, remainingMainProcesses: processSnapshot() }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
