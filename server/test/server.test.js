'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createServer } = require('../src/server');
const { fastConfig, circleTrack, connect } = require('./helpers');

const startServer = async (config = fastConfig) => {
    const server = createServer({ config, tracks: { circle: circleTrack } });
    const port = await server.listen(0);
    return { server, port };
};

const joinAs = async (port, name, ship, options = {}) => {
    const client = await connect(port);
    await client.waitFor((m) => m.t === 'hello');
    client.send({ t: 'join', name, ship, ...options });
    const joined = await client.waitFor((m) => m.t === 'joined');
    return { client, joined };
};

const hostAs = (port, name, ship, options = {}) => joinAs(port, name, ship, { track: 'circle', ...options });

const guestAs = async (port, name, ship, options = {}) => {
    const scout = await connect(port);
    await scout.waitFor((m) => m.t === 'hello');
    scout.send({ t: 'lobby', mode: options.mode });
    const lobby = await scout.waitFor((m) => m.t === 'lobby');
    await scout.close();
    return joinAs(port, name, ship, { room: lobby.room, ...options });
};

test('two clients are matched into a temporary room and race to the finish', async () => {
    const { server, port } = await startServer();
    const a = await hostAs(port, 'Ana', 'SERAPH');
    const b = await guestAs(port, 'Bo', 'IMPERATOR');

    const lobby = await a.client.waitFor((m) => m.t === 'room' && m.players.length === 2);
    assert.deepEqual(lobby.players.map((p) => p.name), ['Ana', 'Bo']);
    assert.equal(lobby.phase, 'lobby');

    await a.client.waitFor((m) => m.t === 'room' && m.phase === 'running');
    await b.client.waitFor((m) => m.t === 'room' && m.phase === 'running');

    let seq = 0;
    const driver = setInterval(() => {
        seq++;
        a.client.send({ t: 'input', seq, steer: 0, throttle: 1 });
        b.client.send({ t: 'input', seq, steer: 0, throttle: 1 });
    }, 16);

    const results = await a.client.waitFor((m) => m.t === 'results', 20000);
    clearInterval(driver);
    assert.equal(results.ranking.length, 2);
    assert.ok(results.ranking.every((r) => r.time > 0));
    assert.equal(server.matchmaker.roomCount(), 0);

    const state = a.client.inbox.filter((m) => m.t === 'state').at(-1);
    assert.ok(state.ack > 0 && state.ack <= seq);
    assert.equal(state.ships.length, 2);

    await a.client.close();
    await b.client.close();
    await server.close();
});

test('invalid messages and unknown ships are rejected without dropping the socket', async () => {
    const { server, port } = await startServer();
    const client = await connect(port);
    client.socket.send('not json');
    await client.waitFor((m) => m.t === 'error' && m.code === 'bad_message');
    client.send({ t: 'join', name: 'x', ship: 'NOPE', track: 'circle' });
    await client.waitFor((m) => m.t === 'error' && m.code === 'unknown_ship');
    client.send({ t: 'join', name: 'x', ship: 'SERAPH', track: 'nowhere' });
    await client.waitFor((m) => m.t === 'error' && m.code === 'unknown_track');
    client.send({ t: 'ping', ts: 42 });
    await client.waitFor((m) => m.t === 'pong' && m.ts === 42);
    await client.close();
    await server.close();
});

test('a dropped client resumes its ship within the grace period', async () => {
    const { server, port } = await startServer();
    const a = await hostAs(port, 'Ana', 'SERAPH');
    const b = await guestAs(port, 'Bo', 'SELENE');
    await a.client.waitFor((m) => m.t === 'room' && m.phase === 'running');

    a.client.socket.terminate();
    await b.client.waitFor((m) => m.t === 'state');

    const returning = await connect(port);
    returning.send({ t: 'resume', token: a.joined.token });
    const resumed = await returning.waitFor((m) => m.t === 'joined');
    assert.equal(resumed.id, a.joined.id);
    assert.equal(resumed.resumed, true);
    const room = await returning.waitFor((m) => m.t === 'room');
    assert.equal(room.players.length, 2);
    await returning.waitFor((m) => m.t === 'state' && m.ships.some((s) => s[0] === a.joined.id));

    const stranger = await connect(port);
    stranger.send({ t: 'resume', token: 'forged' });
    await stranger.waitFor((m) => m.t === 'error' && m.code === 'unknown_token');

    await returning.close();
    await b.client.close();
    await stranger.close();
    await server.close();
});

test('a client that stays disconnected is removed from the race after the grace period', async () => {
    const { server, port } = await startServer();
    const a = await hostAs(port, 'Ana', 'SERAPH');
    const b = await guestAs(port, 'Bo', 'SELENE');
    await a.client.waitFor((m) => m.t === 'room' && m.phase === 'running');

    a.client.socket.terminate();
    const shrunk = await b.client.waitFor((m) => m.t === 'room' && m.phase === 'running' && m.players.length === 1, 3000);
    assert.equal(shrunk.players[0].name, 'Bo');

    await b.client.close();
    await server.close();
});

test('oversized payloads and message floods close the connection', async () => {
    const { server, port } = await startServer();
    const big = await connect(port);
    const bigClosed = new Promise((resolve) => big.socket.once('close', resolve));
    big.socket.send('x'.repeat(2048));
    assert.equal(await bigClosed, 1009);

    const flood = await connect(port);
    const floodClosed = new Promise((resolve) => flood.socket.once('close', resolve));
    for (let i = 0; i < 400; i++) flood.send({ t: 'ping', ts: i });
    assert.equal(await floodClosed, 1008);
    await server.close();
});

test('health endpoint reports rooms and players; unknown upgrade paths are refused', async () => {
    const { server, port } = await startServer();
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.deepEqual(health, { ok: true, rooms: 0, players: 0 });
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(missing.status, 404);
    await server.close();
});

const statusOf = (port, headers) =>
    new Promise((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
        socket.once('open', () => resolve({ status: 101, socket }));
        socket.once('unexpected-response', (_, response) => resolve({ status: response.statusCode }));
        socket.once('error', () => {});
    });

test('connections per IP are capped and released on close', async () => {
    const { server, port } = await startServer({ ...fastConfig, maxConnectionsPerIp: 2 });
    const first = await statusOf(port);
    const second = await statusOf(port);
    assert.deepEqual([first.status, second.status], [101, 101]);
    assert.equal((await statusOf(port)).status, 429);

    first.socket.close();
    await new Promise((resolve) => first.socket.once('close', resolve));
    const reopened = await statusOf(port);
    assert.equal(reopened.status, 101);

    reopened.socket.close();
    second.socket.close();
    await server.close();
});

test('behind a trusted proxy the forwarded client IP is what gets capped', async () => {
    const { server, port } = await startServer({ ...fastConfig, maxConnectionsPerIp: 1, trustProxy: true });
    const a = await statusOf(port, { 'x-forwarded-for': 'spoofed, 10.0.0.1' });
    assert.equal((await statusOf(port, { 'x-forwarded-for': 'other, 10.0.0.1' })).status, 429);
    const b = await statusOf(port, { 'x-forwarded-for': '10.0.0.2' });
    assert.equal(b.status, 101);

    a.socket.close();
    b.socket.close();
    await server.close();
});

test('casts are ignored in the lobby and spend energy once the race runs', async () => {
    const { server, port } = await startServer();
    const a = await hostAs(port, 'Ana', 'SERAPH');
    const b = await guestAs(port, 'Bo', 'SELENE');

    a.client.send({ t: 'cast', spell: 'turbo' });
    a.client.send({ t: 'cast', spell: 'nuke' });
    await a.client.waitFor((m) => m.t === 'error' && m.code === 'bad_message');
    await a.client.waitFor((m) => m.t === 'room' && m.phase === 'running');

    a.client.send({ t: 'cast', spell: 'gun' });
    const fired = await a.client.waitFor(
        (m) => m.t === 'state' && m.ships.find((s) => s[0] === a.joined.id)?.[9] < 96 && m.shots.some(([, spell]) => spell === 'gun'),
    );
    assert.equal(fired.ships.find((s) => s[0] === a.joined.id)[8], 100);

    await a.client.close();
    await b.client.close();
    await server.close();
});

test('deathmatch clients are matched into the arena and receive plane snapshots', async () => {
    const { server, port } = await startServer();
    const a = await hostAs(port, 'Ana', 'SERAPH', { mode: 'deathmatch', track: 'enuma_ichor' });
    const b = await guestAs(port, 'Bo', 'IMPERATOR', { mode: 'deathmatch' });

    const lobby = await a.client.waitFor((m) => m.t === 'room' && m.players.length === 2);
    assert.equal(lobby.mode, 'deathmatch');
    assert.equal(lobby.track, 'enuma_ichor');
    await a.client.waitFor((m) => m.t === 'room' && m.phase === 'running');

    const state = await a.client.waitFor((m) => m.t === 'state' && m.ships.length === 2);
    assert.ok(state.ships.every((ship) => Math.abs(ship[1]) < 130 && Math.abs(ship[2]) < 130 && ship[7] === null));

    await a.client.close();
    await b.client.close();
    await server.close();
});

test('the first pilot picks the stage and later pilots join that stage without choosing one', async () => {
    const { server, port } = await startServer();
    const scout = await connect(port);
    scout.send({ t: 'lobby', mode: 'race' });
    assert.deepEqual(await scout.waitFor((m) => m.t === 'lobby'), { t: 'lobby', room: null, track: null });

    const a = await hostAs(port, 'Ana', 'SERAPH');
    const b = await guestAs(port, 'Bo', 'SELENE');
    const lobby = await b.client.waitFor((m) => m.t === 'room' && m.players.length === 2);
    assert.equal(lobby.track, 'circle');
    assert.equal(lobby.host, a.joined.id);
    assert.equal(server.matchmaker.roomCount(), 1);

    await scout.close();
    await a.client.close();
    await b.client.close();
    await server.close();
});

test('a join must either pick a stage or name a room, never both and never neither', async () => {
    const { server, port } = await startServer();
    const host = await hostAs(port, 'Ana', 'SERAPH');
    const client = await connect(port);
    client.send({ t: 'join', name: 'Bo', ship: 'SELENE', track: 'circle', room: 'r1' });
    await client.waitFor((m) => m.t === 'error' && m.code === 'bad_message');
    client.send({ t: 'join', name: 'Bo', ship: 'SELENE' });
    await client.waitFor((m) => m.t === 'error' && m.code === 'bad_message');
    client.send({ t: 'join', name: 'Bo', ship: 'SELENE', room: 'r99' });
    await client.waitFor((m) => m.t === 'error' && m.code === 'room_unavailable');
    client.send({ t: 'join', name: 'Bo', ship: 'SELENE', room: 'r1', mode: 'vs' });
    await client.waitFor((m) => m.t === 'error' && m.code === 'room_unavailable');

    await client.close();
    await host.client.close();
    await server.close();
});

test('every stage the client offers can be hosted for races and for deathmatch', async () => {
    const { server, port } = await startServer();
    const race = await hostAs(port, 'Ana', 'SERAPH', { track: 'circle' });
    const arena = await hostAs(port, 'Bo', 'SELENE', { mode: 'deathmatch', track: 'resting_soul' });
    const lobby = await arena.client.waitFor((m) => m.t === 'room');
    assert.equal(lobby.track, 'resting_soul');
    assert.equal(server.matchmaker.roomCount(), 2);

    const client = await connect(port);
    client.send({ t: 'join', name: 'Cy', ship: 'SERAPH', mode: 'deathmatch', track: 'circle' });
    await client.waitFor((m) => m.t === 'error' && m.code === 'unknown_track');

    await client.close();
    await race.client.close();
    await arena.client.close();
    await server.close();
});
