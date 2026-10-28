import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKSPACES, configuredWorkspaces, workspaceLabel } from '../lib/outreach/instantly.js';
import { INSTANTLY_SOURCES, OUTREACH_SOURCES, sqlList } from '../lib/outreach/email-sources.js';

// The account has two Instantly workspaces and each is reachable only with its own
// key. Reading just the first one cost this board 43 campaigns, 811 sent emails and
// 14 opportunities while every job still reported itself complete, so these tests
// guard the two places that could narrow back to one workspace without failing.

const withEnv = (vars, fn) => {
  const before = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test('workspaces: only the ones whose key is present are read, and a missing second key is not an error', () => {
  const both = withEnv({ INSTANTLY_API_KEY: 'a', INSTANTLY_SEND_API_KEY: 'b' }, () => configuredWorkspaces().map(w => w.id));
  assert.deepEqual(both, ['instantly', 'instantly_aisdr']);

  const onlyFirst = withEnv({ INSTANTLY_API_KEY: 'a', INSTANTLY_SEND_API_KEY: undefined },
    () => configuredWorkspaces().map(w => w.id));
  assert.deepEqual(onlyFirst, ['instantly'], 'the original workspace still syncs on its own');

  const none = withEnv({ INSTANTLY_API_KEY: undefined, INSTANTLY_SEND_API_KEY: undefined }, () => configuredWorkspaces());
  assert.deepEqual(none, [], 'no key at all is what makes a job report skipped');
});

test('workspaces: each one names its API key and the archive source that carries its email', () => {
  for (const w of WORKSPACES) {
    assert.match(w.envVar, /^INSTANTLY_\w+$/, `${w.id} needs an env var`);
    assert.ok(w.label, `${w.id} needs a label for the health page`);
    assert.ok(INSTANTLY_SOURCES.includes(w.source), `${w.id}'s archive source must be in INSTANTLY_SOURCES`);
  }
  assert.equal(workspaceLabel('instantly_aisdr'), 'Instantly.ai (AI SDR)');
  assert.equal(workspaceLabel('nope'), 'nope', 'an unknown id prints as itself rather than throwing');
});

test('archive sources: both workspaces count as email, and the SQL list quotes each one', () => {
  assert.deepEqual(INSTANTLY_SOURCES, ['instantly', 'instantly_aisdr']);
  assert.deepEqual(OUTREACH_SOURCES, ['instantly', 'instantly_aisdr', 'heyreach']);
  assert.equal(sqlList(OUTREACH_SOURCES), "'instantly', 'instantly_aisdr', 'heyreach'");
});

test("archive readers ask for every workspace's source, not the string 'instantly'", () => {
  for (const file of ['lib/sync/jobs/reply-verdicts.js', 'lib/metrics/conversation.js']) {
    // Comments quote the old query on purpose, to say why it was wrong.
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !/source\s*(=|IN \()\s*'instantly'/.test(code),
      `${file} pins ctx_events.source to one workspace; use email-sources.js instead`
    );
  }
});
