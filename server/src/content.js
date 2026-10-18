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
        projectile: { damage: 6, slow: 0.06, speed: 500, radius: 1.5, life: 1, homing: 0, arenaSpeed: 170, arenaTurn: 0 },
    },
    turbo: { cost: 30, cooldown: 1, boost: 1.5 },
    missile: {
        cost: 35,
        cooldown: 1.5,
        projectile: { damage: 30, slow: 0.3, speed: 300, radius: 2.5, life: 4, homing: 45, arenaSpeed: 110, arenaTurn: 2.5 },
    },
    plasma: {
        cost: 50,
        cooldown: 2,
        projectile: { damage: 40, slow: 0.5, speed: 400, radius: 5, life: 3, homing: 0, arenaSpeed: 140, arenaTurn: 0 },
    },
});

const TRACKS = Object.freeze({
    chapter6: {
        controlPoints: [
            [0, 0, 0],
            [120, 4, -30],
            [240, 10, 0],
            [320, 20, 90],
            [280, 12, 200],
            [160, 0, 240],
            [60, -6, 330],
            [-80, 0, 300],
            [-160, 8, 180],
            [-120, 14, 60],
        ],
        width: 36,
        laps: 3,
    },
});

const ARENAS = Object.freeze({
    battle: {
        halfSize: 130,
        maxSpeed: 60,
        spawnCount: 8,
        spawnRadius: 100,
        obstacles: [
            { x: 0, z: 0, radius: 16 },
            { x: 62, z: 62, radius: 12 },
            { x: -62, z: 62, radius: 12 },
            { x: 62, z: -62, radius: 12 },
            { x: -62, z: -62, radius: 12 },
            { x: 0, z: 100, radius: 7 },
            { x: 0, z: -100, radius: 7 },
            { x: 100, z: 0, radius: 7 },
            { x: -100, z: 0, radius: 7 },
        ],
    },
});

module.exports = { SHIPS, SPELLS, TRACKS, ARENAS };
