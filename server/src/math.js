'use strict';

const TWO_PI = 2 * Math.PI;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const moveToward = (value, target, maxDelta) => {
    const delta = target - value;
    return Math.abs(delta) <= maxDelta ? target : value + Math.sign(delta) * maxDelta;
};

const wrapAngle = (angle) => angle - TWO_PI * Math.round(angle / TWO_PI);

module.exports = { clamp, moveToward, wrapAngle };
