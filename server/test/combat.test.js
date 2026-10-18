'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { SPELLS, TRACKS } = require('../src/content');
const { buildTrack } = require('../src/track');
const { parse } = require('../src/protocol');
const { createShip, stepShip } = require('../src/ship');
const { PHASE, Room } = require('../src/room');
const { circleTrack, createRace, fakePlayer, stepUntil } = require('./helpers');

const DT = 1 / 60;

const gentleTrack = buildTrack({
    controlPoints: Array.from({ length: 12 }, (_, i) => [
        Math.cos((i / 12) * 2 * Math.PI) * 2000,
        0,
        Math.sin((i / 12) * 2 * Math.PI) * 2000,
    ]),
    width: 36,
    laps: 1,
});

const runningRace = (ships) => {
    const race = createRace(config, ships, gentleTrack);
    stepUntil(race.room, () => race.room.phase === PHASE.RUNNING);
    return race;
};

const place = (player, distance, lateral, speed = 0) => Object.assign(player.sim, { distance, lateral, speed, heading: 0 });

test('cast messages are validated against the spell list', () => {
    assert.deepEqual(parse('{"t":"cast","spell":"missile"}', config), { t: 'cast', spell: 'missile' });
    assert.equal(parse('{"t":"cast","spell":"nuke"}', config), null);
    assert.equal(parse('{"t":"cast","spell":"constructor"}', config), null);
    assert.equal(parse('{"t":"cast"}', config), null);
});

test('casting spends energy and starts the cooldown', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [caster, other] = players;
    place(other, 400, 0, 0);
    caster.queueCast('plasma', config.combat.castQueueLimit);
    room.step();
    assert.ok(Math.abs(caster.fighter.energy - (config.combat.maxEnergy - SPELLS.plasma.cost)) < 1);
    caster.queueCast('plasma', config.combat.castQueueLimit);
    room.step();
    assert.equal(room.combat.shots().length, 1);
});

test('a spell is refused without enough energy', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [caster] = players;
    caster.fighter.energy = SPELLS.missile.cost - 1;
    caster.queueCast('missile', config.combat.castQueueLimit);
    room.step();
    assert.equal(room.combat.shots().length, 0);
});

test('energy regenerates up to the maximum', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [caster] = players;
    caster.fighter.energy = 0;
    for (let i = 0; i < 60; i++) room.step();
    assert.ok(Math.abs(caster.fighter.energy - config.combat.energyPerSecond) < 0.5);
    for (let i = 0; i < 60 * 20; i++) room.step();
    assert.equal(caster.fighter.energy, config.combat.maxEnergy);
});

test('casts queued before the race starts are ignored by the gateway rule and cleared on reset', () => {
    const { players } = createRace(config, ['SERAPH', 'SELENE']);
    players[0].queueCast('gun', config.combat.castQueueLimit);
    players[0].resetRace();
    assert.deepEqual(players[0].casts, []);
});

test('the cast queue is bounded', () => {
    const { players } = createRace(config, ['SERAPH', 'SELENE']);
    for (let i = 0; i < 20; i++) players[0].queueCast('gun', config.combat.castQueueLimit);
    assert.equal(players[0].casts.length, config.combat.castQueueLimit);
});

test('a gun shot damages the ship ahead, scaled by attack and shield', () => {
    const { room, players } = runningRace(['IMPERATOR', 'BASTION']);
    const [shooter, target] = players;
    place(shooter, 100, 0, 100);
    place(target, 130, 0, 100);
    shooter.queueCast('gun', config.combat.castQueueLimit);
    stepUntil(room, () => target.fighter.health < config.combat.maxHealth, 120);
    const expected = SPELLS.gun.projectile.damage * (8 / config.combat.referenceAttack) * (config.combat.referenceShield / 8);
    assert.ok(Math.abs(config.combat.maxHealth - target.fighter.health - expected) < 1e-6);
    assert.equal(room.combat.shots().length, 0);
});

test('a shot never hits its owner or a ship behind it', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [shooter, behind] = players;
    place(shooter, 200, 0, 100);
    place(behind, 170, 0, 100);
    shooter.queueCast('gun', config.combat.castQueueLimit);
    for (let i = 0; i < 90; i++) room.step();
    assert.equal(shooter.fighter.health, config.combat.maxHealth);
    assert.equal(behind.fighter.health, config.combat.maxHealth);
});

test('a fast gun shot cannot tunnel through a fast ship', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [shooter, target] = players;
    place(shooter, 100, 0, 300);
    place(target, 112, 0, 300);
    shooter.queueCast('gun', config.combat.castQueueLimit);
    stepUntil(room, () => target.fighter.health < config.combat.maxHealth, 30);
});

test('a missile homes in on a ship in another lane', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [shooter, target] = players;
    place(shooter, 100, -10, 100);
    place(target, 260, 10, 100);
    shooter.queueCast('missile', config.combat.castQueueLimit);
    stepUntil(room, () => target.fighter.health < config.combat.maxHealth, 240);
});

test('a plasma bolt misses a ship outside its width', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [shooter, target] = players;
    place(shooter, 100, -12, 100);
    place(target, 160, 12, 100);
    shooter.queueCast('plasma', config.combat.castQueueLimit);
    for (let i = 0; i < 40; i++) room.step();
    assert.equal(room.combat.shots().length, 1);
    assert.equal(target.fighter.health, config.combat.maxHealth);
});

test('a destroyed ship is stopped, disabled and then recovers at half health', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [shooter, target] = players;
    place(shooter, 100, 0, 100);
    place(target, 130, 0, 100);
    target.fighter.health = 1;
    shooter.queueCast('gun', config.combat.castQueueLimit);
    stepUntil(room, () => target.fighter.disabledTicks > 0, 120);
    assert.equal(target.sim.speed, 0);
    assert.equal(target.fighter.health, config.combat.maxHealth * config.combat.respawnHealthFraction);
    target.applyInput({ seq: 1, steer: 0, throttle: 1 });
    room.step();
    assert.ok(target.sim.speed < 1e-9);
    stepUntil(room, () => target.fighter.disabledTicks === 0, 60 * 3);
    room.step();
    assert.ok(target.sim.speed > 0);
});

test('a disabled ship cannot be hit again or cast', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [shooter, target] = players;
    place(shooter, 100, 0, 100);
    place(target, 130, 0, 100);
    target.fighter.disabledTicks = 100;
    shooter.queueCast('gun', config.combat.castQueueLimit);
    target.queueCast('gun', config.combat.castQueueLimit);
    for (let i = 0; i < 30; i++) room.step();
    assert.equal(target.fighter.health, config.combat.maxHealth);
    assert.equal(target.fighter.energy, config.combat.maxEnergy);
});

test('turbo adds thrust only while its timer runs', () => {
    const track = buildTrack(TRACKS.enuma_ichor);
    const plain = createShip('SERAPH', 0);
    const boosted = createShip('SERAPH', 0);
    boosted.boost = SPELLS.turbo.boost;
    for (let i = 0; i < 60; i++) {
        stepShip(plain, track, 0, 1, DT);
        stepShip(boosted, track, 0, 1, DT);
    }
    assert.ok(Math.abs(boosted.speed - plain.speed - 150) < 1e-6);
    assert.ok(Math.abs(boosted.boost - (SPELLS.turbo.boost - 1)) < 1e-9);

    const expiring = createShip('SERAPH', 0);
    expiring.boost = 0.1;
    for (let i = 0; i < 12; i++) stepShip(expiring, track, 0, 1, DT);
    assert.equal(expiring.boost, 0);
});

test('turbo cast raises speed through the room', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [caster] = players;
    place(caster, 100, 0, 50);
    caster.applyInput({ seq: 1, steer: 0, throttle: 1 });
    caster.queueCast('turbo', config.combat.castQueueLimit);
    for (let i = 0; i < 60; i++) room.step();
    assert.ok(caster.sim.speed > 50 + 50 + 100);
});

test('a rear ship closing on a slower one loses speed and the front ship gains it', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [rear, front] = players;
    place(rear, 100, 0, 200);
    place(front, 104, 0, 100);
    room.collisions.resolve([rear.sim, front.sim]);
    assert.ok(rear.sim.speed < 200 && front.sim.speed > 100);
    assert.ok(Math.abs(rear.sim.speed + front.sim.speed - 300) < 1e-9);
    assert.ok(front.sim.distance - rear.sim.distance >= 6 - 1e-9);
});

test('a heavier ship is pushed less in a collision', () => {
    const { room, players } = runningRace(['BASTION', 'AURIGA']);
    const [heavy, light] = players;
    place(heavy, 100, 0, 100);
    place(light, 100, 1, 100);
    room.collisions.resolve([heavy.sim, light.sim]);
    assert.ok(Math.abs(heavy.sim.lateral) < Math.abs(light.sim.lateral - 1));
    assert.ok(light.sim.lateral - heavy.sim.lateral >= 4 - 1e-9);
});

test('side collisions never push a ship through the wall', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [a, b] = players;
    const limit = circleTrack.width * 0.5 - 2;
    place(a, 100, limit, 100);
    place(b, 100, limit - 1, 100);
    room.collisions.resolve([a.sim, b.sim]);
    assert.ok(Math.abs(a.sim.lateral) <= limit && Math.abs(b.sim.lateral) <= limit);
});

test('ships on different laps at the same spot still collide', () => {
    const { room, players } = runningRace(['SERAPH', 'SELENE']);
    const [a, b] = players;
    place(a, 10, 0, 100);
    place(b, 10 + gentleTrack.length, 1, 100);
    room.collisions.resolve([a.sim, b.sim]);
    assert.ok(Math.abs(b.sim.lateral - a.sim.lateral) >= 4 - 1e-9);
});

test('snapshots carry health, energy and shots', () => {
    const { room, players, inboxes } = runningRace(['SERAPH', 'SELENE']);
    const [shooter] = players;
    place(shooter, 100, 0, 100);
    place(players[1], 400, 0, 100);
    shooter.queueCast('gun', config.combat.castQueueLimit);
    for (let i = 0; i < 6; i++) room.step();
    const state = inboxes[0].filter((m) => m.t === 'state').at(-1);
    const ship = state.ships.find((s) => s[0] === shooter.id);
    assert.equal(ship.length, 10);
    assert.equal(ship[8], 100);
    assert.equal(ship[9], Math.round(((config.combat.maxEnergy - SPELLS.gun.cost + (5 * config.combat.energyPerSecond) / config.tickRate) / config.combat.maxEnergy) * 100));
    assert.equal(state.shots.length, 1);
    assert.equal(state.shots[0][1], 'gun');
    assert.equal(state.shots[0].length, 7);
});

test('a versus room closes after two pilots', () => {
    const room = new Room({ id: 'v1', trackId: 'enuma_ichor', mode: 'vs', track: gentleTrack, config, onClose: () => {} });
    room.add(fakePlayer(1, 'IMPERATOR'));
    assert.equal(room.isOpen(), true);
    room.add(fakePlayer(2, 'BASTION'));
    assert.equal(room.isOpen(), false);
});
