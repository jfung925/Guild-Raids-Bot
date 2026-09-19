'use strict';

/**
 * Run with npm test on a computer with Node.js installed.
 * These tests use temporary files, a local HTTP server, and Discord stand-ins.
 * They never log in to Discord or request a real Wynncraft player or guild.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { ChannelType } = require('discord.js');
const { loadSettings } = require('../helpers/config.helper');
const { WynnClient, WynnError, parseGuild, rankedMembers, retryMilliseconds,
  cacheMilliseconds } = require('../helpers/wynn-api.helper');
const { buildLeaderboard } = require('../helpers/leaderboard.helper');
const { BoardStore } = require('../helpers/state.helper');
const { LeaderboardTask } = require('../intervals/leaderboard');
const { loadCommands, registerCommands } = require('../helpers/command.helper');
const interactionEvent = require('../events/interaction-create');
const { createLogger } = require('../helpers/log.helper');

// Large, synthetic IDs catch accidental conversion to rounded JavaScript numbers.
const SERVER = '1234567890123456789';
const CHANNEL = '1234567890123456790';
const MESSAGE = '1234567890123456791';
const BOT = '1234567890123456792';
const quietLog = { info() {}, warn() {}, error() {} };
const member = (username, current, all = current) => ({ username, globalData: {
  currentGuildRaids: { total: current }, guildRaids: { total: all },
} });
const fixture = () => ({ name: 'Example Guild', members: {
  total: 3,
  owner: { 'uuid-one': member('Alpha', 10, 100) },
  recruit: { 'uuid-two': member('Beta', 0, 20), 'uuid-three': { username: 'Private' } },
} });

async function temporaryDirectory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'raid-bot-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('all rank groups, current/all scopes, private counts, and genuine zeroes', () => {
  const payload = fixture();
  payload.members.future_rank = { extra: member('Future', 30, 50) };
  payload.members.chief = { hidden: { ...member('Hidden', 900), restrictions: { main_access: true } } };
  const snapshot = parseGuild(payload);
  assert.equal(snapshot.members.length, 5);
  assert.deepEqual(rankedMembers(snapshot).map(row => row.current), [30, 10, 0, null, null]);
  assert.equal(rankedMembers(snapshot, 'all')[0].username, 'Alpha');
  assert.equal(snapshot.members.find(row => row.username === 'Hidden').all, null);
});

test('invalid counters remain unknown and malformed responses do not become empty boards', () => {
  for (const count of [null, true, '0', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const snapshot = parseGuild({ name: 'Test', members: { owner: { id: member('Test', count) } } });
    assert.equal(snapshot.members[0].current, null);
  }
  for (const payload of [null, {}, { name: 'Test', members: [] },
    { name: 'Test', members: { total: 5 } }, { name: 'Test', members: { owner: [] } }]) {
    assert.throws(() => parseGuild(payload), WynnError);
  }
});

test('duplicate UUIDs do not inflate the roster; conflicting counts become unknown', () => {
  const payload = fixture();
  payload.members.chief = { 'uuid-one': member('Alpha', 10, 100) };
  assert.equal(parseGuild(payload).members.length, 3);
  payload.members.chief['uuid-one'].globalData.currentGuildRaids.total = 999;
  assert.equal(parseGuild(payload).members.find(row => row.uuid === 'uuid-one').current, null);
});

test('pagination covers 176 members while escaping names and respecting embed limits', () => {
  const payload = { name: '**Guild** @everyone', members: { recruit: {} } };
  for (let i = 0; i < 176; i++) payload.members.recruit['uuid-' + i] = member('*'.repeat(32), i);
  const snapshot = parseGuild(payload, new Date('2026-09-19T00:00:00Z'));
  let rows = 0;
  for (let page = 1; page <= 8; page++) {
    const data = buildLeaderboard(snapshot, { page }).toJSON();
    rows += data.description.split('\n').length;
    assert.ok(data.description.length <= 4096);
    assert.ok(data.title.length <= 256);
    assert.ok(!data.title.includes('@everyone'));
    assert.match(data.description, /\\\*/);
    assert.equal(data.timestamp, '2026-09-19T00:00:00.000Z');
  }
  assert.equal(rows, 176);
  assert.throws(() => buildLeaderboard(snapshot, { page: 9 }), /1 to 8/);
  assert.throws(() => buildLeaderboard(snapshot, { page: 1.5 }), RangeError);
});

test('real HTTP requests encode guild names and coalesce concurrent commands', async t => {
  let requests = 0;
  let requestedUrl;
  const server = http.createServer((request, response) => {
    requests++;
    requestedUrl = request.url;
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=120' });
    response.end(JSON.stringify(fixture()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const client = new WynnClient('Example Guild & Friends', {
    baseUrl: 'http://127.0.0.1:' + server.address().port + '/v3',
  });
  const snapshots = await Promise.all(Array.from({ length: 20 }, () => client.getGuild()));
  await client.getGuild();
  assert.equal(requests, 1);
  assert.equal(new URL(requestedUrl, 'http://localhost').searchParams.get('identifier'), 'uuid');
  assert.ok(requestedUrl.startsWith('/v3/guild/Example%20Guild%20%26%20Friends?'));
  assert.ok(snapshots.every(snapshot => snapshot === snapshots[0]));
});

test('429 respects reset headers and prevents repeated requests during backoff', async () => {
  let calls = 0;
  let now = 0;
  const api = new WynnClient('Test', { clock: () => now, fetchImpl: async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'RateLimit-Reset': '180' } });
  } });
  await assert.rejects(api.getGuild(), /request limit/);
  now = 120000;
  await assert.rejects(api.getGuild(), /60 seconds/);
  assert.equal(calls, 1);
  now = 180001;
  await assert.rejects(api.getGuild(), /request limit/);
  assert.equal(calls, 2);
});

test('Retry-After HTTP dates, zero headers, and malformed cache headers are handled', () => {
  const now = Date.parse('2026-09-19T00:00:00Z');
  assert.equal(retryMilliseconds(new Headers({ 'Retry-After': new Date(now + 300000).toUTCString() }), now), 300000);
  assert.equal(retryMilliseconds(new Headers({ 'RateLimit-Reset': '0' }), now), 60000);
  assert.equal(cacheMilliseconds(new Headers({ 'Cache-Control': 'public, max-age=300' })), 300000);
  assert.equal(cacheMilliseconds(new Headers({ 'Cache-Control': 'max-age=Infinity' })), 120000);
  assert.equal(cacheMilliseconds(new Headers({ 'Cache-Control': 'max-age=' + '9'.repeat(308) })), 120000);
});

test('404, invalid JSON, and network failures back off without creating fake snapshots', async () => {
  for (const request of [
    async () => new Response('', { status: 404 }),
    async () => new Response('<html>not JSON</html>', { status: 200 }),
    async () => { throw new TypeError('Network unavailable'); },
  ]) {
    let calls = 0;
    const api = new WynnClient('Test', { fetchImpl: async (...args) => { calls++; return request(...args); } });
    await assert.rejects(api.getGuild(), WynnError);
    await assert.rejects(api.getGuild(), /Try again in about/);
    assert.equal(calls, 1);
    assert.equal(api.snapshot, null);
  }
});

test('failed refresh preserves the last successful snapshot and timestamp', async () => {
  let calls = 0;
  let now = 0;
  const api = new WynnClient('Test', { clock: () => now, fetchImpl: async () => {
    calls++;
    return calls === 1 ? Response.json(fixture()) : new Response('', { status: 503 });
  } });
  const first = await api.getGuild();
  now = 120001;
  await assert.rejects(api.getGuild(), /503/);
  assert.equal(api.snapshot, first);
  assert.equal(api.snapshot.retrievedAt, first.retrievedAt);
});

test('zero remaining requests after success blocks an expired-cache refresh until reset', async () => {
  let now = 0;
  let calls = 0;
  const api = new WynnClient('Test', { clock: () => now, fetchImpl: async () => {
    calls++;
    return Response.json(fixture(), { headers: { 'RateLimit-Remaining': '0', 'RateLimit-Reset': '300' } });
  } });
  await api.getGuild();
  now = 120001;
  await assert.rejects(api.getGuild(), /request limit/);
  assert.equal(calls, 1);
});

test('configuration precedence, exact string IDs, and token privacy', async t => {
  const root = await temporaryDirectory(t);
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({
    token: 'synthetic-test-token', discordServerId: SERVER, guildName: 'From JSON',
  }));
  await fs.writeFile(path.join(root, '.env'), 'WYNN_GUILD_NAME="From dotenv"\nREFRESH_SECONDS=600\n');
  const settings = loadSettings({ root, env: { WYNN_GUILD_NAME: 'From host' } });
  assert.equal(settings.guildName, 'From host');
  assert.equal(settings.serverId, SERVER);
  assert.equal(settings.refreshSeconds, 600);
  assert.ok(!JSON.stringify(settings).includes('synthetic-test-token'));
  assert.equal(loadSettings({ root, env: {} }).guildName, 'From dotenv');
  assert.throws(() => loadSettings({ root, env: { REFRESH_SECONDS: '30' } }), /120 and 86400/);
  assert.throws(() => loadSettings({ root, env: { RUN_MODE: 'typo' } }), /RUN_MODE/);
});

test('API diagnostics need no Discord token; numeric JSON IDs are rejected', async t => {
  const root = await temporaryDirectory(t);
  const settings = loadSettings({ root, env: { WYNN_GUILD_NAME: 'Example Guild', RUN_MODE: 'check-api' } });
  assert.equal(settings.token, '');
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({
    token: 'synthetic-test-token', discordServerId: 1234567890123456789, guildName: 'Example Guild',
  }));
  assert.throws(() => loadSettings({ root, env: {} }), /double quotes/);
  await fs.writeFile(path.join(root, 'config.json'), '{ "token": "synthetic-private-token", broken }');
  assert.throws(() => loadSettings({ root, env: {} }), error => !error.message.includes('synthetic-private-token'));
});

test('state survives a restart, preserves long IDs, and respects channel changes', async t => {
  const file = path.join(await temporaryDirectory(t), 'data', 'leaderboard.json');
  const store = new BoardStore(file);
  await store.checkWritable();
  assert.equal(await store.read(SERVER, CHANNEL), null);
  await store.save(SERVER, CHANNEL, MESSAGE);
  assert.equal(await new BoardStore(file).read(SERVER, CHANNEL), MESSAGE);
  assert.equal(await store.read(SERVER, '1234567890123456799'), null);
  const contents = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(typeof contents.messageId, 'string');
});

test('legacy Python IDs migrate without rounding; corrupt state remains untouched', async t => {
  const file = path.join(await temporaryDirectory(t), 'leaderboard.json');
  const store = new BoardStore(file);
  await fs.writeFile(file, '{"server_id":' + SERVER + ',"channel_id":' + CHANNEL + ',"message_id":' + MESSAGE + '}');
  assert.equal(await store.read(SERVER, CHANNEL), MESSAGE);
  await fs.writeFile(file, '{broken');
  await assert.rejects(store.read(SERVER, CHANNEL), /damaged or unsupported/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

function fakeBoard(options = {}) {
  const calls = { sends: 0, edits: 0, saves: 0 };
  const message = { id: MESSAGE, author: { id: BOT },
    async edit(payload) { calls.edits++; calls.lastPayload = payload; } };
  const channel = {
    type: ChannelType.GuildText, guildId: SERVER,
    messages: { async fetch() { return message; } },
    async send(payload) { calls.sends++; calls.lastPayload = payload; return message; },
  };
  const context = {
    client: { user: { id: BOT }, channels: { async fetch() { return channel; } } },
    settings: { serverId: SERVER, channelId: CHANNEL, refreshSeconds: 300 },
    api: { async getGuild() { return parseGuild(fixture()); } },
    store: { async save() { calls.saves++; } }, log: quietLog,
    ...options,
  };
  return { calls, channel, message, context, task: new LeaderboardTask(context) };
}

test('concurrent automatic refreshes create one board, then edit the saved message', async () => {
  const { task, calls, context } = fakeBoard();
  await Promise.all([task.refresh(), task.refresh(), task.refresh()]);
  assert.equal(calls.sends, 1);
  const restarted = new LeaderboardTask({ ...context, messageId: task.messageId });
  await restarted.refresh();
  assert.equal(calls.sends, 1);
  assert.equal(calls.edits, 1);
});

test('deleted messages are replaced; permission failures do not create duplicates', async () => {
  const board = fakeBoard({ messageId: MESSAGE });
  board.channel.messages.fetch = async () => { throw Object.assign(new Error('Unknown Message'), { code: 10008 }); };
  await board.task.refresh();
  assert.equal(board.calls.sends, 1);
  board.channel.messages.fetch = async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); };
  await assert.rejects(board.task.refresh(), /Missing Permissions/);
  assert.equal(board.calls.sends, 1);
});

test('API failure leaves the Discord message untouched; foreign messages are not edited', async () => {
  const board = fakeBoard({ messageId: MESSAGE });
  board.context.api.getGuild = async () => { throw new WynnError('API unavailable'); };
  await assert.rejects(board.task.refresh(), /API unavailable/);
  assert.equal(board.calls.edits, 0);
  assert.equal(board.calls.sends, 0);
  board.context.api.getGuild = async () => parseGuild(fixture());
  board.message.author.id = '1234567890123456799';
  await assert.rejects(board.task.refresh(), /another user/);
  assert.equal(board.calls.edits, 0);
});

test('temporary disk failure retains the newly sent ID for the next refresh', async () => {
  const board = fakeBoard();
  board.context.store.save = async () => { throw new Error('Disk full'); };
  await assert.rejects(board.task.refresh(), /Disk full/);
  assert.equal(board.task.messageId, MESSAGE);
  board.context.store.save = async () => {};
  await board.task.refresh();
  assert.equal(board.calls.sends, 1);
  assert.equal(board.calls.edits, 1);
});

test('the three real command builders serialize and registration uses server-specific upserts', async () => {
  const commands = loadCommands();
  assert.deepEqual([...commands.keys()].sort(), ['guildraids', 'help', 'ping']);
  const calls = [];
  const client = { application: { commands: { async create(data, server) { calls.push({ data, server }); } } } };
  await registerCommands(client, commands, SERVER);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.server === SERVER));
  const raid = commands.get('guildraids').data.toJSON();
  assert.equal(raid.options.find(option => option.name === 'page').min_value, 1);
  assert.deepEqual(raid.options.find(option => option.name === 'scope').choices.map(choice => choice.value), ['current', 'all']);
});

test('a raid command acknowledges first and returns an API failure through its deferred reply', async () => {
  const sequence = [];
  const interaction = {
    guildId: SERVER, commandName: 'guildraids', deferred: false, replied: false,
    isChatInputCommand: () => true,
    async deferReply() { sequence.push('defer'); this.deferred = true; },
    async editReply(reply) { sequence.push('reply'); this.output = reply; },
    options: { getInteger: () => null, getString: () => null },
  };
  const context = { settings: { serverId: SERVER }, commands: loadCommands(), log: quietLog,
    api: { async getGuild() { sequence.push('api'); throw new WynnError('Test outage'); } } };
  await interactionEvent.execute(interaction, context);
  assert.deepEqual(sequence, ['defer', 'api', 'reply']);
  assert.equal(interaction.output.content, 'Test outage');
  assert.deepEqual(interaction.output.allowedMentions, { parse: [] });
});

test('logs redact the configured token without serializing Discord request bodies', t => {
  const lines = [];
  t.mock.method(console, 'error', line => lines.push(line));
  const token = 'synthetic-sensitive-token';
  createLogger(token).error('Failure ' + token, Object.assign(new Error('Error ' + token), {
    requestBody: { secret: 'not-for-logs' }, code: 50013,
  }));
  assert.ok(lines[0].includes('[REDACTED]'));
  assert.ok(!lines[0].includes(token));
  assert.ok(!lines[0].includes('not-for-logs'));
});
