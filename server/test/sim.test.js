'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const defaultConfig = require('../src/config');
const { TRACKS } = require('../src/content');
const { buildTrack } = require('../src/track');
const { createShip, stepShip } = require('../src/ship');
const { PHASE } = require('../src/room');
const { fakePlayer, createRace, stepUntil } = require('./helpers');

const DT = 1 / 60;

test('track matches the native game geometry', () => {
    const track = buildTrack(TRACKS.ordeal_nights);
    assert.ok(Math.abs(track.length - 6183.852) < 0.01);
    assert.ok(Math.abs(track.curvatureAt(2488.37) - -0.007143) < 1e-5);
    assert.ok(Math.abs(track.curvatureAt(5482.37) - 0.005203) < 1e-5);
    assert.ok(Math.abs(track.curvatureAt(0) - track.curvatureAt(track.length)) < 1e-9);
});

test('ship physics match the native game trajectory', () => {
    const track = buildTrack(TRACKS.ordeal_nights);
    const ship = createShip('AURIGA', -6.75);
    for (let tick = 0; tick < 1800; tick++) {
        const phase = Math.floor(tick / 90) % 3;
        stepShip(ship, track, phase === 0 ? 1 : phase === 1 ? -0.5 : 0, tick % 400 < 300 ? 1 : 0, DT);
    }
    assert.ok(Math.abs(ship.distance - 3009.6479) < 0.05);
    assert.ok(Math.abs(ship.lateral - -16) < 1e-6);
    assert.ok(Math.abs(ship.speed - 193.4086) < 0.01);
});

test('enuma ichor loops keep steering curvature within what a ship can follow', () => {
    const track = buildTrack(TRACKS.enuma_ichor);
    assert.ok(Math.abs(track.length - 3877.43) < 0.1);
    for (let along = 0; along < track.length; along += 2) assert.ok(Math.abs(track.curvatureAt(along)) < 0.01);
});

const driveTo = (track, along, speed) => {
    const ship = createShip('AURIGA', 0, along);
    ship.speed = speed;
    return ship;
};

test('a fast ship clears a jump gap and a slow one falls and respawns before the ramp', () => {
    const track = buildTrack(TRACKS.enuma_ichor);
    const [start, span] = TRACKS.enuma_ichor.gaps[0];

    const fast = driveTo(track, start - 20, 250);
    for (let tick = 0; tick < 60; tick++) stepShip(fast, track, 0, 1, DT);
    assert.ok(fast.distance > start + span);
    assert.equal(fast.air, 0);

    const slow = driveTo(track, start - 0.3, 40);
    stepShip(slow, track, 0, 1, DT);
    assert.ok(slow.air < 0);
    for (let tick = 0; tick < 120 && slow.air < 0; tick++) stepShip(slow, track, 0, 0, DT);
    assert.equal(slow.air, 0);
    assert.ok(Math.abs(slow.distance - (start + span)) < 1e-6);
    assert.equal(slow.speed, 0);
    assert.equal(slow.lateral, 0);
});

test('a jump that loses its speed mid-air falls to the landing point instead of hovering', () => {
    const track = buildTrack(TRACKS.enuma_ichor);
    const [start, span] = TRACKS.enuma_ichor.gaps[0];

    const ship = driveTo(track, start + 5, 150);
    stepShip(ship, track, 0, 1, DT);
    assert.equal(ship.air, 0);
    ship.speed = 0;
    stepShip(ship, track, 0, 0, DT);
    assert.ok(ship.air < 0);
    for (let tick = 0; tick < 240 && ship.air < 0; tick++) stepShip(ship, track, 0, 0, DT);
    assert.equal(ship.air, 0);
    assert.ok(Math.abs(ship.distance - (start + span)) < 1e-6);
    assert.equal(ship.speed, 0);
});

test('boost pads fire only in their lane', () => {
    const track = buildTrack(TRACKS.enuma_ichor);
    const [start, , lane] = TRACKS.enuma_ichor.pads[1];

    const onLane = driveTo(track, start + 5, 100);
    onLane.lateral = lane * 12;
    stepShip(onLane, track, 0, 1, DT);
    assert.ok(onLane.boost > 0);

    const offLane = driveTo(track, start + 5, 100);
    offLane.lateral = lane * 12 + 12;
    stepShip(offLane, track, 0, 1, DT);
    assert.equal(offLane.boost, 0);
});

test('magic pads never boost and boost pads never refill', () => {
    const track = buildTrack(TRACKS.enuma_ichor);
    const [magicStart, , magicLane] = TRACKS.enuma_ichor.pads.find(([, , , kind]) => kind === 1);
    const ship = driveTo(track, magicStart + 5, 100);
    ship.lateral = magicLane * 12;
    stepShip(ship, track, 0, 1, DT);
    assert.equal(ship.boost, 0);
    assert.ok(track.onPad(ship.distance, ship.lateral, 1));
    assert.ok(!track.onPad(ship.distance, ship.lateral, 0));
});

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

test('inputs are consumed one per tick so clients can replay them exactly', () => {
    const { room, players } = createRace(defaultConfig, ['SERAPH', 'SELENE']);
    stepUntil(room, () => room.phase === PHASE.RUNNING);
    const [player] = players;
    [1, 2, 3].forEach((seq) => player.applyInput({ seq, steer: 0, throttle: 1 }));
    room.step();
    assert.equal(player.applied.seq, 1);
    room.step();
    assert.equal(player.applied.seq, 2);
    room.step();
    room.step();
    assert.equal(player.applied.seq, 3);
});

test('requiem eternal splits into two walled branches with their own jumps', () => {
    const track = buildTrack(TRACKS.requiem_eternal);
    assert.ok(Math.abs(track.length - 4755.842) < 0.01);

    const plateau = 1000;
    assert.equal(track.clampLateral(plateau, -10, 2), -track.clampLateral(plateau, 10, 2));
    assert.ok(Math.abs(track.clampLateral(plateau, 10, 2)) > 40);
    assert.equal(track.clampLateral(plateau, 60, 2), 60);
    assert.ok(Math.abs(track.clampLateral(plateau, 100, 2)) < 80);
    assert.equal(track.clampLateral(plateau * 0 + 100, 100, 2), 16);
    assert.ok(track.branchCenter(plateau, 1) > 0 && track.branchCenter(plateau, -1) < 0);

    assert.notEqual(track.gapAt(760, -30), null);
    assert.equal(track.gapAt(760, 30), null);
    assert.notEqual(track.gapAt(4240, -5), null);
    assert.notEqual(track.gapAt(4240, 5), null);
});

test('a ship that falls on a branch respawns on the same branch', () => {
    const track = buildTrack(TRACKS.requiem_eternal);
    const ship = createShip('AURIGA', -60, 720);
    ship.speed = 30;
    const [gapStart, gapSpan] = track.gapAt(760, -30);
    let falling = false;
    for (let tick = 0; tick < 600 && !(falling && ship.air === 0); tick++) {
        stepShip(ship, track, 0, ship.air < 0 ? 0 : 1, DT);
        if (ship.air < 0) falling = true;
    }
    assert.ok(falling);
    assert.ok(Math.abs(ship.distance - (gapStart + gapSpan)) < 1e-6);
    assert.equal(ship.speed, 0);
    assert.ok(ship.lateral < -40);
});

test('ships cannot cross the void between branches', () => {
    const track = buildTrack(TRACKS.requiem_eternal);
    const ship = createShip('AURIGA', 30, 700);
    ship.speed = 200;
    for (let tick = 0; tick < 90; tick++) {
        stepShip(ship, track, -1, 1, DT);
        assert.ok(ship.lateral > 0);
        assert.equal(track.clampLateral(ship.distance, ship.lateral, 2), ship.lateral);
    }
});

test('every branch jump sits on the flat part of its fork and pads stay on their ribbons', () => {
    for (const id of ['requiem_eternal', 'resting_soul', 'beneath_nadir', 'nightingale_revenant']) {
        const def = TRACKS[id];
        for (const [start, span, side = 0] of def.gaps) {
            if (side === 0) continue;
            const fork = def.forks.find(([from, length]) => start - 50 >= from + length * 0.25 && start + span + 50 <= from + length * 0.75);
            assert.ok(fork, `${id} gap at ${start} is outside a fork plateau`);
        }
    }
});

test('new stage lengths', () => {
    const lengths = { resting_soul: 4306.91, beneath_nadir: 5463.59, nightingale_revenant: 4697.03 };
    for (const [id, length] of Object.entries(lengths)) {
        assert.ok(Math.abs(buildTrack(TRACKS[id]).length - length) < 0.01, id);
    }
    assert.equal(TRACKS.resting_soul.width, 60);
});
