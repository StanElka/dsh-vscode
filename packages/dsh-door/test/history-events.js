import assert from 'node:assert/strict';
import { summarizeSession, sessionTranscript } from '../lib/history-events.js';
import { doorSessionsMethod, doorSessionsResult, doorSessionsError, isDoorSessionsRequest } from '../lib/frames.js';

const events = [
  { type: 'session', version: 4, id: 'current', cwd: '/workspace', createdAt: 100, agentPreset: 'standard' },
  { type: 'session/title', seq: 1, time: 101, data: { title: 'Current history' } },
  { type: 'turn/start', seq: 2, time: 102, data: { turn: 1 } },
  { type: 'user/message', seq: 3, time: 103, data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'hidden policy' }] } },
  { type: 'user/message', seq: 4, time: 104, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Read the file' }] } },
  { type: 'assistant/message', seq: 5, time: 105, data: { message: { content: [{ type: 'reasoning', text: 'Inspect first' }, { type: 'text', text: 'Reading' }] } } },
  { type: 'tool/call', seq: 6, time: 106, data: { callId: 'read-1', name: 'read', arguments: '{"path":"sample.js"}' } },
  { type: 'tool/result', seq: 7, time: 107, data: { message: { toolCallId: 'read-1', content: [{ type: 'tool-result', content: [{ type: 'text', text: 'file contents' }] }] } } },
];
const card = summarizeSession(events);
assert.equal(card.id, 'current'); assert.equal(card.title, 'Current history'); assert.equal(card.cwd, '/workspace');
assert.equal(card.userMessages, 1); assert.equal(card.turns, 1); assert.equal(card.lastTime, 107);
assert.equal(card.fallbackTitle, 'Read the file');
const replay = sessionTranscript(events);
assert.deepEqual(replay.entries.map(item => item.kind), ['user', 'assistant', 'tool']);
assert.equal(replay.entries[0].text, 'Read the file');
assert.equal(replay.entries[1].thinking, 'Inspect first'); assert.equal(replay.entries[2].output, 'file contents');
assert(!JSON.stringify(replay).includes('hidden policy'));
assert.equal(sessionTranscript(events.slice(0, -1)).entries.length, 2, 'Unfinished tools are not replayed as completed');
const limited = sessionTranscript(events, { maxEntries: 1 }); assert(limited.truncated); assert.equal(limited.entries.length, 1);
const long = sessionTranscript([{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(100) }] } }], { maxChars: 10 });
assert.match(long.entries[0].text, /截断/);
for (const method of ['list', 'get']) {
  const frame = { jsonrpc: '2.0', id: 7, method: 'dsh-door/sessions/' + method };
  assert(isDoorSessionsRequest(frame)); assert.equal(doorSessionsMethod(frame), method);
}
assert(!isDoorSessionsRequest({ method: 'dsh-door/sessions/list' }));
assert(!isDoorSessionsRequest({ id: 7, method: 'session/prompt' }));
assert.deepEqual(doorSessionsResult(7, {}), { jsonrpc: '2.0', id: 7, result: {} });
assert.equal(doorSessionsError(7, -32000, 'failure').error.message, 'failure');
console.log('PASS current history event projection, metadata, noise filtering, tools, truncation and RPC envelopes');
