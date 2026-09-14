import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LABELS, buildPrompt, classifyReply, parseLabel } from '../lib/reply-llm.js';

const itemOf = user => JSON.parse(user.slice(user.indexOf('{')));

test('reply labels: every label the views test for is one the model can return', () => {
  const sql = readFileSync(new URL('../db/migrations/900_dash_views.sql', import.meta.url), 'utf8');
  const view = sql.slice(sql.indexOf('CREATE VIEW dash_v_reply_verdicts'), sql.indexOf('CREATE VIEW dash_v_campaigns'));
  const used = [...view.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).filter(word => !['rules', 'llm'].includes(word));
  assert.ok(used.length >= 3, 'the view should name the negative and non-response labels');
  for (const label of used) assert.ok(LABELS.includes(label), `${label} is not a label the model returns`);
});

test('reply labels: only labels the dashboard knows are accepted from the model', () => {
  assert.deepEqual(parseLabel({ reason: 'Asked for a demo', label: 'interested' }), { label: 'interested', reason: 'Asked for a demo' });
  assert.equal(parseLabel({ reason: 'Not a real label', label: 'maybe' }), null);
  assert.equal(parseLabel(null), null);
});

test('reply labels: the prompt names the channel, keeps a subject only when there is one, and trims long replies', () => {
  const linkedin = itemOf(buildPrompt({ platform: 'linkedin', body: 'y'.repeat(5000) }));
  assert.equal(linkedin.channel, 'LinkedIn message');
  assert.equal(linkedin.reply.length, 1500);
  assert.equal(linkedin.subject, undefined);
  assert.equal(itemOf(buildPrompt({ platform: 'email', subject: 'Re: quick question', body: 'No thanks' })).subject, 'Re: quick question');
});

test('reply labels: a usable answer costs exactly one call', async () => {
  let calls = 0;
  const complete = async () => { calls++; return { value: { reason: 'Clear no', label: 'declined' } }; };
  assert.deepEqual(await classifyReply({ body: 'No thanks' }, { complete }), { label: 'declined', reason: 'Clear no' });
  assert.equal(calls, 1);
});

test('reply labels: an unusable answer gets exactly one more try, then is given up on', async () => {
  let calls = 0;
  const unusable = async () => { calls++; return { value: { reason: 'Unsure', label: 'maybe' } }; };
  assert.deepEqual(await classifyReply({ body: 'Hmm' }, { complete: unusable }), { error: 'no_answer' });
  assert.equal(calls, 2);

  let tries = 0;
  const flaky = async () => {
    tries++;
    if (tries === 1) throw Object.assign(new Error('cut-off JSON'), { code: 'invalid_json' });
    return { value: { reason: 'Leave notice', label: 'auto' } };
  };
  assert.equal((await classifyReply({ body: 'Out of office' }, { complete: flaky })).label, 'auto');
  assert.equal(tries, 2);
});

test('reply labels: a content-filter refusal is not asked again, and other errors stop the run', async () => {
  let calls = 0;
  const refused = async () => { calls++; throw Object.assign(new Error('filtered'), { code: 'refused' }); };
  assert.deepEqual(await classifyReply({ body: 'blocked words' }, { complete: refused }), { error: 'refused' });
  assert.equal(calls, 1);

  const unauthorized = async () => { throw Object.assign(new Error('Azure OpenAI returned 401'), { status: 401 }); };
  await assert.rejects(classifyReply({ body: 'Hi' }, { complete: unauthorized }), /401/);
});
