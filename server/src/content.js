'use strict';

const SHIPS = Object.freeze({
    SERAPH: { steerRate: 1.7, shield: 5 },
    SELENE: { steerRate: 1.7, shield: 5 },
    AURIGA: { steerRate: 2.0, shield: 3 },
    TEMPERANCE: { steerRate: 1.9, shield: 3 },
    BASTION: { steerRate: 1.5, shield: 8 },
    COLOSSUS: { steerRate: 1.5, shield: 7 },
    IMPERATOR: { steerRate: 1.6, shield: 4 },
    REGINA: { steerRate: 1.6, shield: 4 },
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

module.exports = { SHIPS, TRACKS };
