import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const deployScriptPath = resolve('deploy.sh');

describe('deploy.sh', () => {
  it('passes the health report JavaScript directly to Node without shell interpolation', async () => {
    const script = await readFile(deployScriptPath, 'utf8');
    const healthReport = script.match(/print_health_report\(\) \{(?<body>[\s\S]*?)\n\}/)?.groups
      ?.body;

    assert.ok(healthReport, 'print_health_report function must exist');
    assert.doesNotMatch(healthReport, /sh -c/);
    assert.doesNotMatch(healthReport, /fetch\(`/);
    assert.match(
      healthReport,
      /node -e 'const port=process\.env\.API_PORT\|\|3000; fetch\("http:\/\/127\.0\.0\.1:"\+port\+"\/health"\)/,
    );
  });
});
