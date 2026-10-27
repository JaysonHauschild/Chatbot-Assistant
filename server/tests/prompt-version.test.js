'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { nextPromptVersion } = require('../lib/prompt-version');

test('version letters increment while keeping the numeric release unchanged', () => {
  for (const [before, after] of [['1.0.0a', '1.0.0b'], ['1.3.4g', '1.3.4h'], ['1.0.0', '1.0.0a'], ['1.0.0z', '1.0.0aa'], ['1.0.0az', '1.0.0ba'], ['1.0.0zz', '1.0.0aaa']]) {
    assert.equal(nextPromptVersion(before), after);
  }
  assert.throws(() => nextPromptVersion('invalid'), /Release version/);
});

test('dashboard prompt saves and restores bump versions only on changes and preserve state on failure', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-prompt-version-'));
  const env = {
    SYSTEM_PROMPT_PATH: path.join(tempDir, 'prompt.txt'), RELEASE_PATH: path.join(tempDir, 'release.json'),
    DASHBOARD_ROLLBACK_DIR: path.join(tempDir, 'rollback'), AI_RESPONSE_LOG_PATH: path.join(tempDir, 'log.jsonl'), JWT_SECRET: 'test-secret',
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  fs.writeFileSync(env.SYSTEM_PROMPT_PATH, 'Original prompt.\n');
  fs.writeFileSync(env.RELEASE_PATH, JSON.stringify({ version: '1.3.4g', name: 'Keep metadata' }));
  const modules = ['../routes/dashboard', '../routes/auth', '../lib/state', '../lib/prompt-version', '../util/logger'];
  const clear = () => modules.forEach((name) => { delete require.cache[require.resolve(name)]; });
  clear();
  const { state } = require('../lib/state');
  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/dashboard'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ role: 'dashboard' }, env.JWT_SECRET)}` };
  const save = (systemPrompt) => fetch(`${base}/system-prompt`, { method: 'PUT', headers, body: JSON.stringify({ systemPrompt }) });
  const version = () => JSON.parse(fs.readFileSync(env.RELEASE_PATH, 'utf8')).version;
  try {
    const unauthorized = await fetch(`${base}/system-prompt`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemPrompt: 'No auth' }) });
    assert.equal(unauthorized.status, 401);
    assert.equal((await save(' ')).status, 400);
    assert.equal(version(), '1.3.4g');
    const saved = await save('Updated prompt.');
    assert.equal(saved.status, 200);
    const data = await saved.json();
    assert.equal(data.version, '1.3.4h');
    assert.equal(state.releaseVersion, '1.3.4h');
    assert.equal(state.systemPrompt, 'Updated prompt.');
    assert.equal(fs.readFileSync(env.SYSTEM_PROMPT_PATH, 'utf8'), 'Updated prompt.\n');
    assert.equal(JSON.parse(fs.readFileSync(env.RELEASE_PATH, 'utf8')).name, 'Keep metadata');
    const unchanged = await (await save('  Updated prompt.\n')).json();
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.version, '1.3.4h');
    const restore = () => fetch(`${base}/dashboard/rollback-snapshots/restore`, { method: 'POST', headers, body: JSON.stringify({ targetType: 'system_prompt', snapshotId: data.rollbackSnapshotId }) });
    assert.equal((await (await restore()).json()).version, '1.3.4i');
    assert.equal(state.systemPrompt, 'Original prompt.');
    assert.equal((await (await restore()).json()).version, '1.3.4i');
    const originalRename = fs.renameSync;
    const mock = t.mock.method(fs, 'renameSync', (source, destination) => {
      if (destination === env.RELEASE_PATH) throw new Error('Version commit failed');
      return originalRename(source, destination);
    });
    const failed = await save('Must not persist.');
    assert.equal(failed.status, 500);
    assert.equal(state.systemPrompt, 'Original prompt.');
    assert.equal(state.releaseVersion, '1.3.4i');
    assert.equal(fs.readFileSync(env.SYSTEM_PROMPT_PATH, 'utf8'), 'Original prompt.\n');
    assert.equal(version(), '1.3.4i');
    mock.mock.restore();
    const read = await (await fetch(`${base}/system-prompt`, { headers })).json();
    assert.equal(read.version, '1.3.4i');
    assert.equal(fs.readdirSync(tempDir).some((name) => name.includes('.tmp-')), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    clear();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
