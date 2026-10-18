'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const defaultConfig = require('../src/config');
const { TRACKS } = require('../src/content');
const { buildTrack } = require('../src/track');
const { createShip, stepShip } = require('../src/ship');
const { Room, PHASE } = require('../src/room');
const { fakePlayer, circleTrack } = require('./helpers');

const DT = 1 / 60;

test('track matches the native game geometry', () => {
    const track = buildTrack(TRACKS.chapter6);
    assert.ok(Math.abs(track.length - 1320.2825) < 0.01);
    assert.ok(Math.abs(track.curvatureAt(track.length / 12 + 0.37) - -0.00482539) < 1e-4);
    assert.ok(Math.abs(track.curvatureAt((track.length * 7) / 12 + 0.37) - -0.0103403) < 1e-4);
    assert.ok(Math.abs(track.curvatureAt(0) - track.curvatureAt(track.length)) < 1e-9);
});

test('ship physics match the native game trajectory', () => {
    const track = buildTrack(TRACKS.chapter6);
    const ship = createShip('AURIGA', -6.75);
    for (let tick = 0; tick < 1800; tick++) {
        const phase = Math.floor(tick / 90) % 3;
        stepShip(ship, track, phase === 0 ? 1 : phase === 1 ? -0.5 : 0, tick % 400 < 300 ? 1 : 0, DT);
    }
    assert.ok(Math.abs(ship.distance - 2039.4105) < 0.05);
    assert.ok(Math.abs(ship.lateral - -16) < 1e-6);
    assert.ok(Math.abs(ship.speed - 138.3229) < 0.01);
});

const createRace = (config, shipNames) => {
    const inboxes = shipNames.map(() => []);
    const players = shipNames.map((ship, i) => fakePlayer(i + 1, ship, inboxes[i]));
    let closed = false;
    const room = new Room({ id: 'r1', trackId: 'circle', track: circleTrack, config, onClose: () => (closed = true) });
    players.forEach((player) => room.add(player));
    return { room, players, inboxes, isClosed: () => closed };
};

const stepUntil = (room, condition, maxTicks = 100000) => {
    for (let i = 0; i < maxTicks && !condition(); i++) room.step();
    assert.ok(condition(), 'condition not reached');
};

test('a lone player waits in the lobby forever', () => {
    const { room } = createRace(defaultConfig, ['SERAPH']);
    for (let i = 0; i < 60 * 60; i++) room.step();
    assert.equal(room.phase, PHASE.LOBBY);
});

test('lobby fills, counts down and runs a full race with a ranking', () => {
    const { room, players, inboxes, isClosed } = createRace(defaultConfig, ['SERAPH', 'BASTION']);
    assert.equal(room.phase, PHASE.LOBBY);
    assert.equal(room.phaseTicks, 10 * 60);

    stepUntil(room, () => room.phase === PHASE.COUNTDOWN);
    assert.deepEqual(players.map((p) => p.startLateral), [-2.25, 2.25]);

    stepUntil(room, () => room.phase === PHASE.RUNNING);
    assert.equal(room.raceTick, 0);

    const [fast, idle] = players;
    fast.applyInput({ seq: 1, steer: 0, throttle: 1 });
    stepUntil(room, () => isClosed());

    const results = inboxes[0].find((m) => m.t === 'results');
    assert.deepEqual(results.ranking.map((r) => r.id), [fast.id, idle.id]);
    assert.ok(results.ranking[0].time > 0 && results.ranking[1].time === null);
    assert.equal(fast.room, null);
    assert.equal(idle.room, null);

    const state = inboxes[0].filter((m) => m.t === 'state').at(-1);
    assert.equal(state.ack, 1);
    assert.equal(state.ships.length, 2);
});

test('a countdown aborts back to the lobby when players drop below the minimum', () => {
    const { room, players } = createRace(defaultConfig, ['SERAPH', 'SELENE']);
    stepUntil(room, () => room.phase === PHASE.COUNTDOWN);
    room.remove(players[1]);
    assert.equal(room.phase, PHASE.LOBBY);
    assert.equal(room.phaseTicks, null);
    assert.equal(players[0].sim, null);
});

test('leaving mid-race ends the race for the remaining finished player', () => {
    const { room, players, isClosed } = createRace(defaultConfig, ['SERAPH', 'SELENE']);
    stepUntil(room, () => room.phase === PHASE.RUNNING);
    players[0].applyInput({ seq: 1, steer: 0, throttle: 1 });
    stepUntil(room, () => players[0].finishTime !== null);
    assert.equal(room.phase, PHASE.RUNNING);
    room.remove(players[1]);
    assert.ok(isClosed());
});

test('stale and out-of-order inputs are ignored', () => {
    const player = fakePlayer(1, 'SERAPH');
    player.applyInput({ seq: 5, steer: 1, throttle: 1 });
    player.applyInput({ seq: 4, steer: -1, throttle: 0 });
    assert.deepEqual(player.input, { seq: 5, steer: 1, throttle: 1 });
});

test('a full lobby starts after the short full-lobby delay', () => {
    const { room } = createRace(defaultConfig, Array(8).fill('SERAPH'));
    assert.equal(room.phaseTicks, 3 * 60);
    assert.equal(room.isOpen(), false);
});
