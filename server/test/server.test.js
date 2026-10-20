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

const enter = async (port, mode) => {
    const client = await connect(port);
    await client.waitFor((m) => m.t === 'hello');
    client.send({ t: 'lobby', mode });
    const lobby = await client.waitFor((m) => m.t === 'lobby');
    return { client, lobby };
};

const joinAs = async (port, name, ship, { track = 'circle', mode } = {}) => {
    const { client, lobby } = await enter(port, mode);
    if (lobby.role === 'host') client.send({ t: 'stage', track });
    client.send({ t: 'join', name, ship, room: lobby.room, mode });
    const joined = await client.waitFor((m) => m.t === 'joined');
    return { client, joined, lobby };
};

const hostAs = joinAs;
const guestAs = joinAs;

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
    assert.ok(results.ranking[0].time > 0);
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
    client.send({ t: 'join', name: 'x', ship: 'NOPE', room: 'r1' });
    await client.waitFor((m) => m.t === 'error' && m.code === 'unknown_ship');
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

test('the first pilot opens the room at once and later pilots go straight to choosing a ship', async () => {
    const { server, port } = await startServer();
    const first = await enter(port, 'race');
    assert.deepEqual(first.lobby, { t: 'lobby', role: 'host', room: 'r1', track: null });
    assert.equal(server.matchmaker.roomCount(), 1);

    const second = await enter(port, 'race');
    assert.deepEqual(second.lobby, { t: 'lobby', role: 'guest', room: 'r1', track: null });
    second.client.send({ t: 'join', name: 'Bo', ship: 'SELENE', room: 'r1' });
    const waiting = await second.client.waitFor((m) => m.t === 'room' && m.players.length === 1);
    assert.equal(waiting.track, null);
    assert.equal(waiting.laps, 0);
    assert.equal(waiting.endsIn, null);

    first.client.send({ t: 'stage', track: 'circle' });
    const staged = await second.client.waitFor((m) => m.t === 'room' && m.track === 'circle');
    assert.equal(staged.phase, 'lobby');
    first.client.send({ t: 'join', name: 'Ana', ship: 'SERAPH', room: 'r1' });
    const full = await second.client.waitFor((m) => m.t === 'room' && m.players.length === 2);
    assert.equal(full.host, (await first.client.waitFor((m) => m.t === 'joined')).id);
    await second.client.waitFor((m) => m.t === 'room' && m.phase === 'running');
    assert.equal(server.matchmaker.roomCount(), 1);

    await first.client.close();
    await second.client.close();
    await server.close();
});

test('a guest who enters after the stage is chosen receives it with the lobby answer', async () => {
    const { server, port } = await startServer();
    const host = await hostAs(port, 'Ana', 'SERAPH');
    const guest = await enter(port, 'race');
    assert.deepEqual(guest.lobby, { t: 'lobby', role: 'guest', room: 'r1', track: 'circle' });

    await host.client.close();
    await guest.client.close();
    await server.close();
});

test('a join must name a room', async () => {
    const { server, port } = await startServer();
    const host = await hostAs(port, 'Ana', 'SERAPH');
    const client = await connect(port);
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

test('every stage the client offers can be chosen for races and for deathmatch', async () => {
    const { server, port } = await startServer();
    const race = await hostAs(port, 'Ana', 'SERAPH', { track: 'circle' });
    const arena = await hostAs(port, 'Bo', 'SELENE', { mode: 'deathmatch', track: 'resting_soul' });
    const lobby = await arena.client.waitFor((m) => m.t === 'room');
    assert.equal(lobby.track, 'resting_soul');
    assert.equal(server.matchmaker.roomCount(), 2);

    const stranger = await enter(port, 'deathmatch');
    assert.equal(stranger.lobby.role, 'guest');
    stranger.client.send({ t: 'stage', track: 'circle' });
    await stranger.client.waitFor((m) => m.t === 'error' && m.code === 'not_host');

    const other = await enter(port, 'vs');
    assert.equal(other.lobby.role, 'host');
    other.client.send({ t: 'stage', track: 'nowhere' });
    await other.client.waitFor((m) => m.t === 'error' && m.code === 'unknown_track');
    other.client.send({ t: 'stage', track: 'circle' });
    other.client.send({ t: 'stage', track: 'circle' });
    await other.client.waitFor((m) => m.t === 'error' && m.code === 'not_host');

    await stranger.client.close();
    await other.client.close();
    await race.client.close();
    await arena.client.close();
    await server.close();
});

test('seats held by pilots still choosing a ship count toward the room capacity', async () => {
    const { server, port } = await startServer();
    const first = await enter(port, 'vs');
    const second = await enter(port, 'vs');
    const third = await enter(port, 'vs');
    assert.deepEqual([first.lobby.role, second.lobby.role, third.lobby.role], ['host', 'guest', 'host']);
    assert.notEqual(third.lobby.room, first.lobby.room);

    await first.client.close();
    await second.client.close();
    await third.client.close();
    await server.close();
});

test('when the host leaves before choosing a stage the room is dissolved and its guests are told', async () => {
    const { server, port } = await startServer();
    const host = await enter(port, 'race');
    const guest = await joinAs(port, 'Bo', 'SELENE');
    assert.equal(guest.lobby.role, 'guest');
    await guest.client.waitFor((m) => m.t === 'room');

    await host.client.close();
    await guest.client.waitFor((m) => m.t === 'error' && m.code === 'host_left');
    assert.equal(server.matchmaker.roomCount(), 0);

    await guest.client.close();
    await server.close();
});

test('a room with nobody in it and nobody on the way closes', async () => {
    const { server, port } = await startServer();
    const host = await enter(port, 'race');
    host.client.send({ t: 'stage', track: 'circle' });
    await host.client.close();
    for (let i = 0; i < 50 && server.matchmaker.roomCount() > 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(server.matchmaker.roomCount(), 0);

    await server.close();
});
