'use strict';

const { SHIPS } = require('./content');
const { clamp, moveToward } = require('./math');

const ACCELERATION = 50;
const BRAKING = 100;
const WALL_BOUNCE = 0.3;
const WALL_DRAG = 3;
const SHIP_RADIUS = 2;
const TURN_SPEED_RAMP = 40;
const MAX_HEADING = 0.6;
const MAX_LATERAL_SPEED = 40;
const ROLL_AT_FULL_STEER = 0.5;
const TILT_RESPONSE = 10;
const BANK_PER_TURN_RATE = 0.12;
const MAX_BANK = 0.45;
const WALL_BOUNCE_HEADING = 0.25;
const BRAKE_GLOW_RATE = 8;
const REFERENCE_SPEED = 277.5;
const BOOST_ACCELERATION = 150;
const OVERSPEED_SOFTNESS = 5;
const PAD_BOOST_SECONDS = 1;
const MIN_JUMP_SPEED = 90;
const FALL_SPEED = 60;
const FALL_DEPTH = 40;
const RESPAWN_BACK = 90;
const RESPAWN_SPEED_KEPT = 0.4;

const dampedThrust = (thrust, speed) =>
    thrust <= 0 ? thrust : thrust / (1 + Math.max(0, speed - REFERENCE_SPEED) / OVERSPEED_SOFTNESS);

const resolveWall = (ship, track, dt) => {
    const clamped = track.clampLateral(ship.distance, ship.lateral, SHIP_RADIUS);
    if (clamped === ship.lateral) return;

    const side = Math.sign(ship.lateral - clamped);
    ship.lateral = clamped;

    const into = ship.heading * side;
    if (into <= 0) return;

    ship.heading = into > WALL_BOUNCE_HEADING ? -ship.heading * WALL_BOUNCE : 0;
    ship.speed *= 1 - clamp((WALL_DRAG / SHIPS[ship.name].shield) * dt, 0, 1);
};

const createShip = (name, lateral, distance = 0) => ({
    name,
    distance,
    lateral,
    heading: 0,
    speed: 0,
    roll: 0,
    brakeGlow: 0,
    boost: 0,
    air: 0,
});

const stepAir = (ship, track, previousDistance, dt) => {
    const gap = track.gapAt(ship.distance, ship.lateral);
    if (gap === null) {
        ship.air = 0;
        return;
    }
    const entered = track.gapAt(previousDistance, ship.lateral) === null;
    if (entered && ship.speed < MIN_JUMP_SPEED) ship.air = -dt * FALL_SPEED;
    else if (ship.air < 0) ship.air -= FALL_SPEED * dt;
    if (ship.air >= 0) return;

    if (ship.air < -FALL_DEPTH) {
        ship.distance = gap[0] - RESPAWN_BACK;
        ship.lateral = track.branchCenter(ship.distance, gap[2] ?? 0);
        ship.heading = 0;
        ship.speed *= RESPAWN_SPEED_KEPT;
        ship.boost = 0;
        ship.air = 0;
    }
};


const stepShip = (ship, track, steer, throttle, dt) => {
    const boosting = ship.boost > 0;
    const braking = throttle <= 0 && !boosting && ship.speed > 0;
    ship.brakeGlow = moveToward(ship.brakeGlow, braking ? 1 : 0, BRAKE_GLOW_RATE * dt);
    ship.boost = Math.max(0, ship.boost - dt);
    const thrust = throttle * ACCELERATION - (1 - throttle) * BRAKING + (boosting ? BOOST_ACCELERATION : 0);
    ship.speed = Math.max(0, ship.speed + dampedThrust(thrust, ship.speed) * dt);

    const curvature = track.curvatureAt(ship.distance);
    const authority = clamp(ship.speed / TURN_SPEED_RAMP, 0, 1) * Math.max(1, ship.speed / REFERENCE_SPEED);
    const headingLimit = Math.min(MAX_HEADING, Math.asin(clamp(MAX_LATERAL_SPEED / Math.max(ship.speed, 1), 0, 1)));

    ship.heading += steer * SHIPS[ship.name].steerRate * authority * dt;
    ship.heading += curvature * ship.speed * Math.cos(ship.heading) * dt;
    ship.heading = clamp(ship.heading, -headingLimit, headingLimit);

    ship.lateral += ship.speed * Math.sin(ship.heading) * dt;
    const previousDistance = ship.distance;
    ship.distance += ship.speed * Math.cos(ship.heading) * dt;
    stepAir(ship, track, previousDistance, dt);
    if (track.onPad(ship.distance, ship.lateral)) ship.boost = Math.max(ship.boost, PAD_BOOST_SECONDS);

    resolveWall(ship, track, dt);

    const bank = clamp(-curvature * ship.speed * BANK_PER_TURN_RATE, -MAX_BANK, MAX_BANK);
    ship.roll += (steer * ROLL_AT_FULL_STEER + bank - ship.roll) * (1 - Math.exp(-TILT_RESPONSE * dt));
};

module.exports = { SHIP_RADIUS, createShip, stepShip };
