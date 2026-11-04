'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { HistorySummaryCache, CACHE_TTL } = require('../src/panel/history-cache');
const originalLoad = Module._load;
let DshPanelView;
try {
  Module._load = function (request, ...args) { return request === 'vscode' ? { workspace: { isTrusted: true } } : originalLoad.call(this, request, ...args); };
  ({ DshPanelView } = require('../src/panel/view'));
} finally { Module._load = originalLoad; }
function store() { const values = new Map(); return { get: key => values.get(key), update: async (key, value) => values.set(key, structuredClone(value)) }; }
function panel(state, client) { return Object.assign(Object.create(DshPanelView.prototype), { workspaceState: state, client, config: () => ({ host: '127.0.0.1', port: 49123 }), errText: error => error.message, log() {} }); }
(async () => {
  const state = store(), scope = { cwd: path.resolve('build/offline-history-project'), limit: 30 };
  let sessions = [{ id: 'current', title: 'Current', cwd: scope.cwd }];
  const client = { isConnected: true, listHistory: async () => ({ sessions, total: sessions.length, offset: 0, archiveStateKnown: true }) };
  const live = panel(state, client);
  assert.equal((await live.readHistory('list', undefined, scope)).via, 'door');
  const offline = panel(state), cached = await offline.readHistory('list', undefined, scope);
  assert.equal(cached.via, 'cache'); assert.equal(cached.result.sessions.length, 1);
  assert.equal(cached.result.cacheScope.cwd, scope.cwd); assert(cached.result.limited); assert(!('entries' in cached.result));
  await assert.rejects(offline.readHistory('list', undefined, { cwd: '/other' }), /请连接 DSH/);
  await assert.rejects(offline.readHistory('get', 'current'), /请连接 DSH/);
  assert(cached.result.limitation.includes('已删除'), 'Cached cards do not claim a deleted session still exists');
  sessions = []; await live.readHistory('list', undefined, scope);
  assert.equal((await panel(state).readHistory('list', undefined, scope)).result.sessions.length, 0);
  const missing = panel(store(), { isConnected: true, async listHistory() { throw Object.assign(new Error('method not found'), { code: -32601 }); } });
  await assert.rejects(missing.readHistory('list'), /配套版本/);
  const failing = panel(state, { isConnected: true, async listHistory() { throw new Error('server read failed'); } });
  await assert.rejects(failing.readHistory('list', undefined, scope), /server read failed/);
  client.listHistory = async () => { throw Object.assign(new Error('connection closed'), { code: 'ECONNRESET' }); };
  assert.equal((await live.readHistory('list', undefined, scope)).via, 'cache');
  let now = Date.now(); const expiring = new HistorySummaryCache(store(), { now: () => now });
  await expiring.put('fixture', scope, { sessions: [{ id: 'only' }] }); now += CACHE_TTL + 1;
  assert.equal(expiring.get('fixture', scope), undefined);
  console.log('PASS offline scoped summary cache, expiry, refresh, missing-interface diagnostics and live errors; no disk fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
