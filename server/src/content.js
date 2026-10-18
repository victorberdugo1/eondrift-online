'use strict';

const SHIPS = Object.freeze({
    SERAPH: { steerRate: 1.7, shield: 5, attack: 5 },
    SELENE: { steerRate: 1.7, shield: 5, attack: 4 },
    AURIGA: { steerRate: 2.0, shield: 3, attack: 5 },
    TEMPERANCE: { steerRate: 1.9, shield: 3, attack: 4 },
    BASTION: { steerRate: 1.5, shield: 8, attack: 4 },
    COLOSSUS: { steerRate: 1.5, shield: 7, attack: 5 },
    IMPERATOR: { steerRate: 1.6, shield: 4, attack: 8 },
    REGINA: { steerRate: 1.6, shield: 4, attack: 7 },
});

const SPELLS = Object.freeze({
    gun: {
        cost: 8,
        cooldown: 0.15,
        projectile: { damage: 6, slow: 0.06, speed: 500, radius: 1.5, life: 1, homing: 0, arenaSpeed: 500, arenaTurn: 0, barrels: [-1.4, 1.4], barrelDamageScale: 0.6 },
    },
    turbo: { cost: 30, cooldown: 1, boost: 1.5 },
    missile: {
        cost: 35,
        cooldown: 1.5,
        projectile: { damage: 30, slow: 0.3, speed: 300, radius: 2.5, life: 4, homing: 45, arenaSpeed: 110, arenaTurn: 2.5, barrels: [0], barrelDamageScale: 1 },
    },
    plasma: {
        cost: 50,
        cooldown: 2,
        projectile: { damage: 40, slow: 0.5, speed: 400, radius: 5, life: 3, homing: 0, arenaSpeed: 140, arenaTurn: 0, barrels: [0], barrelDamageScale: 1 },
    },
});

const STAGES = require('./stages.json').stages;

const ARENA_DEFAULTS = Object.freeze({ maxSpeed: 60, spawnCount: 8, spawnRadius: 100 });

const SPAWN_RADIUS = Object.freeze({ requiem_eternal: 87, beneath_nadir: 116 });

const TRACKS = Object.freeze(Object.fromEntries(STAGES.map(({ id, track }) => [id, track])));

const ARENAS = Object.freeze(Object.fromEntries(STAGES.map(({ id, arena }) => [id, { ...ARENA_DEFAULTS, spawnRadius: SPAWN_RADIUS[id] ?? ARENA_DEFAULTS.spawnRadius, ...arena }])));

module.exports = { SHIPS, SPELLS, TRACKS, ARENAS };
