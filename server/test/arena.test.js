'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { ARENAS, SPELLS } = require('../src/content');
const { buildArena, buildArenas, createArenaShip, stepArenaShip } = require('../src/arena');
const { ArenaRoom } = require('../src/arena_room');
const { PHASE } = require('../src/room');
const { createMatchmaker } = require('../src/matchmaker');
const { SHIP_RADIUS } = require('../src/ship');
const { fakePlayer, stepUntil } = require('./helpers');

const DT = 1 / 60;
const FACING_NORTH = 0;

const openArena = buildArena({ ...ARENAS.battle, obstacles: [] });
const battle = buildArenas(ARENAS).battle;

const runningArena = (ships, arena = openArena) => {
    const inboxes = ships.map(() => []);
    const players = ships.map((ship, i) => fakePlayer(i + 1, ship, inboxes[i]));
    const room = new ArenaRoom({ id: 'd1', trackId: 'battle', mode: 'deathmatch', arena, config, onClose: () => {} });
    players.forEach((player) => room.add(player));
    stepUntil(room, () => room.phase === PHASE.RUNNING);
    return { room, players, inboxes };
};

const place = (player, x, z, heading = FACING_NORTH, speed = 0) => Object.assign(player.sim, { x, z, heading, speed });

const hideAway = (players, except, spacing = 40) =>
    players.filter((player) => !except.includes(player)).forEach((player, i) => place(player, -100 + i * spacing, 100));

test('the battle arena has a spawn ring clear of walls and obstacles', () => {
    assert.equal(battle.spawns.length, ARENAS.battle.spawnCount);
    for (const spawn of battle.spawns) {
        assert.ok(Math.max(Math.abs(spawn.x), Math.abs(spawn.z)) < battle.halfSize - SHIP_RADIUS);
        for (const obstacle of battle.obstacles) {
            assert.ok(Math.hypot(spawn.x - obstacle.x, spawn.z - obstacle.z) > obstacle.radius + 4 * SHIP_RADIUS);
        }
        const towardCenter = [Math.sin(spawn.heading), -Math.cos(spawn.heading)];
        assert.ok(towardCenter[0] * spawn.x + towardCenter[1] * spawn.z < 0);
    }
});

test('an arena ship accelerates to the arena top speed and no further', () => {
    const ship = createArenaShip('SERAPH', { x: 0, z: 0, heading: FACING_NORTH });
    for (let i = 0; i < 600; i++) stepArenaShip(ship, openArena, 0, 1, DT);
    assert.ok(Math.abs(ship.speed - openArena.maxSpeed) < 1e-6);
    assert.ok(ship.z < 0);
    assert.ok(Math.abs(ship.x) < 1e-6);
});

test('an arena ship turns freely through a full circle', () => {
    const ship = createArenaShip('AURIGA', { x: 0, z: 0, heading: FACING_NORTH });
    for (let i = 0; i < 600; i++) stepArenaShip(ship, openArena, 1, 1, DT);
    assert.ok(ship.heading > 2 * Math.PI);
    assert.ok(Math.hypot(ship.x, ship.z) < openArena.halfSize);
});

test('turbo lifts the top speed only while it lasts', () => {
    const ship = createArenaShip('SERAPH', { x: 0, z: 0, heading: FACING_NORTH });
    for (let i = 0; i < 300; i++) stepArenaShip(ship, openArena, 0, 1, DT);
    ship.boost = 1.5;
    for (let i = 0; i < 60; i++) stepArenaShip(ship, openArena, 0, 1, DT);
    assert.ok(ship.speed > openArena.maxSpeed * 1.2);
    for (let i = 0; i < 600; i++) stepArenaShip(ship, openArena, 0, 1, DT);
    assert.ok(Math.abs(ship.speed - openArena.maxSpeed) < 1e-6);
});

test('walls keep a ship inside the arena and bounce it back', () => {
    const ship = createArenaShip('SERAPH', { x: 0, z: 0, heading: FACING_NORTH });
    let bounced = false;
    for (let i = 0; i < 1200; i++) {
        stepArenaShip(ship, openArena, 0, 1, DT);
        assert.ok(Math.abs(ship.x) <= openArena.halfSize - SHIP_RADIUS + 1e-9);
        assert.ok(Math.abs(ship.z) <= openArena.halfSize - SHIP_RADIUS + 1e-9);
        bounced ||= Math.cos(ship.heading) < 0;
    }
    assert.ok(bounced);
});

test('obstacles stop a ship from driving through them', () => {
    const wall = buildArena({ ...ARENAS.battle, obstacles: [{ x: 0, z: -40, radius: 10 }] });
    const ship = createArenaShip('BASTION', { x: 0, z: 0, heading: FACING_NORTH });
    for (let i = 0; i < 600; i++) {
        stepArenaShip(ship, wall, 0, 1, DT);
        assert.ok(Math.hypot(ship.x, ship.z + 40) >= 10 + SHIP_RADIUS - 1e-9);
    }
});

test('a glancing hit on an obstacle keeps more speed than a head-on one', () => {
    const wall = buildArena({ ...ARENAS.battle, obstacles: [{ x: 20, z: -40, radius: 10 }] });
    const lowestSpeedAfterImpact = (x) => {
        const ship = createArenaShip('SERAPH', { x, z: 0, heading: FACING_NORTH });
        let lowest = Infinity;
        for (let i = 0; i < 160; i++) {
            const before = ship.speed;
            stepArenaShip(ship, wall, 0, 1, DT);
            if (ship.speed < before - 1) lowest = Math.min(lowest, ship.speed);
        }
        return lowest;
    };
    assert.ok(lowestSpeedAfterImpact(10) > lowestSpeedAfterImpact(20));
});

test('an arena match holds eight pilots, spawns them apart and has no finish line', () => {
    const ships = ['SERAPH', 'SELENE', 'AURIGA', 'TEMPERANCE', 'BASTION', 'COLOSSUS', 'IMPERATOR', 'REGINA'];
    const { room, players } = runningArena(ships, battle);
    assert.equal(room.maxPlayers, config.room.maxPlayers);
    const spots = new Set(players.map(({ sim }) => `${Math.round(sim.x)},${Math.round(sim.z)}`));
    assert.equal(spots.size, 8);
    players.forEach((player) => player.applyInput({ seq: 1, steer: 0, throttle: 1 }));
    for (let i = 0; i < 600; i++) room.step();
    assert.ok(players.every((player) => player.finishTime === null));
    assert.ok(players.every(({ sim }) => Math.max(Math.abs(sim.x), Math.abs(sim.z)) <= battle.halfSize));
});

test('two pilots start on opposite sides of the arena', () => {
    const { players } = runningArena(['IMPERATOR', 'BASTION'], battle);
    const [a, b] = players.map(({ sim }) => sim);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > battle.halfSize);
});

test('a gun shot flies straight across the plane and damages the ship it meets', () => {
    const { room, players } = runningArena(['IMPERATOR', 'BASTION']);
    const [shooter, target] = players;
    place(shooter, 0, 0);
    place(target, 0, -40);
    shooter.queueCast('gun', config.combat.castQueueLimit);
    for (let i = 0; i < 30; i++) room.step();
    const expected = SPELLS.gun.projectile.damage * (8 / config.combat.referenceAttack) * (config.combat.referenceShield / 8);
    assert.ok(Math.abs(config.combat.maxHealth - target.fighter.health - expected) < 1e-6);
    assert.equal(room.combat.shots().length, 0);
});

test('a shot never hits its owner or a ship behind it', () => {
    const { room, players } = runningArena(['IMPERATOR', 'BASTION']);
    const [shooter, target] = players;
    place(shooter, 0, 0);
    place(target, 0, 40);
    shooter.queueCast('gun', config.combat.castQueueLimit);
    for (let i = 0; i < 30; i++) room.step();
    assert.equal(shooter.fighter.health, config.combat.maxHealth);
    assert.equal(target.fighter.health, config.combat.maxHealth);
});

test('a shot fired sideways travels along the ship heading', () => {
    const { room, players } = runningArena(['IMPERATOR', 'BASTION']);
    const [shooter, target] = players;
    place(shooter, 0, 0, Math.PI / 2);
    place(target, 50, 0);
    shooter.queueCast('gun', config.combat.castQueueLimit);
    for (let i = 0; i < 30; i++) room.step();
    assert.ok(target.fighter.health < config.combat.maxHealth);
});

test('a missile turns toward a ship off to the side', () => {
    const { room, players } = runningArena(['IMPERATOR', 'BASTION']);
    const [shooter, target] = players;
    place(shooter, 0, 0);
    place(target, 30, -60);
    shooter.queueCast('missile', config.combat.castQueueLimit);
    for (let i = 0; i < 180; i++) room.step();
    assert.ok(target.fighter.health < config.combat.maxHealth);
});

test('a missile ignores a ship behind the shooter', () => {
    const { room, players } = runningArena(['IMPERATOR', 'BASTION']);
    const [shooter, target] = players;
    place(shooter, 0, 0);
    place(target, 0, 40);
    shooter.queueCast('missile', config.combat.castQueueLimit);
    room.step();
    assert.equal(room.combat.shots()[0].target, null);
});

test('shots are stopped by walls and obstacles', () => {
    const wall = buildArena({ ...ARENAS.battle, obstacles: [{ x: 0, z: -30, radius: 8 }] });
    const { room, players } = runningArena(['IMPERATOR', 'BASTION'], wall);
    const [shooter, target] = players;
    place(shooter, 0, 0);
    place(target, 0, -60);
    shooter.queueCast('gun', config.combat.castQueueLimit);
    for (let i = 0; i < 60; i++) room.step();
    assert.equal(target.fighter.health, config.combat.maxHealth);
    assert.equal(room.combat.shots().length, 0);
});

test('ships bump each other apart instead of overlapping', () => {
    const { room, players } = runningArena(['IMPERATOR', 'BASTION']);
    const [a, b] = players;
    place(a, 0, 0, Math.PI / 2, 40);
    place(b, 6, 0, -Math.PI / 2, 40);
    for (let i = 0; i < 20; i++) room.step();
    assert.ok(Math.hypot(a.sim.x - b.sim.x, a.sim.z - b.sim.z) >= 2 * SHIP_RADIUS - 1e-6);
});

test('a destroyed pilot stays down and the enemy wins the match', () => {
    const { room, players, inboxes } = runningArena(['IMPERATOR', 'BASTION']);
    const [shooter, target] = players;
    place(shooter, 0, 0);
    place(target, 0, -40);
    target.fighter.health = 1;
    shooter.queueCast('gun', config.combat.castQueueLimit);
    stepUntil(room, () => inboxes[0].some((message) => message.t === 'results'), 300);
    const results = inboxes[0].find((message) => message.t === 'results');
    assert.deepEqual(results.ranking.map((entry) => entry.id), [shooter.id, target.id]);
});

test('in a four pilot match the last survivor wins and defeats rank in reverse order', () => {
    const { room, players, inboxes } = runningArena(['IMPERATOR', 'BASTION', 'SERAPH', 'SELENE']);
    const [shooter, first, second, third] = players;
    for (const victim of [first, second, third]) {
        victim.fighter.health = 1;
        place(shooter, 0, 0);
        place(victim, 0, -40);
        hideAway(players, [shooter, victim]);
        shooter.fighter.cooldowns.gun = 0;
        shooter.queueCast('gun', config.combat.castQueueLimit);
        stepUntil(room, () => victim.fighter === null || victim.fighter.defeated, 300);
        if (victim !== third) assert.equal(inboxes[0].some((message) => message.t === 'results'), false);
    }
    const results = inboxes[0].find((message) => message.t === 'results');
    assert.deepEqual(results.ranking.map((entry) => entry.id), [shooter.id, third.id, second.id, first.id]);
});

test('the match ends on timeout and ranks the pilots by remaining health', () => {
    const { room, players, inboxes } = runningArena(['IMPERATOR', 'BASTION']);
    players[0].fighter.health = 20;
    stepUntil(room, () => inboxes[0].some((message) => message.t === 'results'), config.tickRate * config.room.deathmatchTimeoutSeconds + 10);
    const results = inboxes[0].find((message) => message.t === 'results');
    assert.deepEqual(results.ranking.map((entry) => entry.id), [players[1].id, players[0].id]);
});

test('a defeated pilot can no longer drive or be hit', () => {
    const { room, players } = runningArena(['IMPERATOR', 'BASTION', 'SERAPH']);
    const [shooter, victim] = players;
    place(shooter, 0, 0);
    place(victim, 0, -40);
    victim.fighter.health = 1;
    victim.applyInput({ seq: 1, steer: 0, throttle: 1 });
    shooter.queueCast('gun', config.combat.castQueueLimit);
    for (let i = 0; i < 90; i++) room.step();
    assert.equal(victim.fighter.defeated, true);
    assert.ok(victim.sim.speed < 1);
});

test('snapshots carry plane positions for ships and shots', () => {
    const { room, players, inboxes } = runningArena(['IMPERATOR', 'BASTION']);
    const [shooter, target] = players;
    place(shooter, 12.5, 3, 1.25, 0);
    place(target, -50, -50);
    shooter.queueCast('gun', config.combat.castQueueLimit);
    for (let i = 0; i < 6; i++) room.step();
    const state = inboxes[0].filter((message) => message.t === 'state').at(-1);
    const row = state.ships.find((ship) => ship[0] === shooter.id);
    assert.equal(row.length, 10);
    assert.ok(Math.abs(row[1] - 12.5) < 0.01 && Math.abs(row[2] - 3) < 0.01);
    assert.equal(row[8], 100);
    assert.equal(state.shots.length, 1);
    assert.equal(state.shots[0].length, 7);
    assert.equal(state.shots[0][1], 'gun');
});

test('the room message announces the deathmatch without laps', () => {
    const { room, inboxes } = runningArena(['IMPERATOR', 'BASTION']);
    const message = inboxes[0].filter((entry) => entry.t === 'room').at(-1);
    assert.equal(message.mode, 'deathmatch');
    assert.equal(message.laps, 0);
    assert.equal(room.trackId, 'battle');
});

test('the matchmaker routes deathmatch players into an arena room', () => {
    const matchmaker = createMatchmaker({ config, tracks: {}, arenas: { battle } });
    const first = fakePlayer(1, 'SERAPH');
    const second = fakePlayer(2, 'SELENE');
    matchmaker.join(first, matchmaker.defaultArenaId, 'deathmatch');
    matchmaker.join(second, matchmaker.defaultArenaId, 'deathmatch');
    assert.ok(first.room instanceof ArenaRoom);
    assert.equal(first.room, second.room);
    assert.equal(matchmaker.roomCount(), 1);
});
