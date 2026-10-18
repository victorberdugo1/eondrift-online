'use strict';

const { SHIPS } = require('./content');
const { SHIP_RADIUS } = require('./ship');
const { clamp, moveToward, wrapAngle } = require('./math');

const ACCELERATION = 45;
const BRAKING = 80;
const OVERSPEED_DECAY = 60;
const BOOST_SPEED_FACTOR = 1.5;
const BOOST_ACCELERATION = 150;
const TURN_SPEED_RAMP = 15;
const TURN_GAIN = 1.4;
const ROLL_AT_FULL_STEER = 0.5;
const TILT_RESPONSE = 10;
const BRAKE_GLOW_RATE = 8;
const WALL_RESTITUTION = 0.4;
const OBSTACLE_RESTITUTION = 0.5;
const MIN_HEADING_SPEED = 1;

const buildArena = ({ halfSize, maxSpeed, obstacles, spawnCount, spawnRadius }) => {
    const spawns = Array.from({ length: spawnCount }, (_, i) => {
        const angle = ((i + 0.5) / spawnCount) * 2 * Math.PI;
        return {
            x: Math.cos(angle) * spawnRadius,
            z: Math.sin(angle) * spawnRadius,
            heading: Math.atan2(-Math.cos(angle), Math.sin(angle)),
        };
    });
    return Object.freeze({ halfSize, maxSpeed, obstacles, spawns });
};

const buildArenas = (defs) =>
    Object.fromEntries(Object.entries(defs).map(([id, def]) => [id, buildArena(def)]));

const createArenaShip = (name, { x, z, heading }) => ({
    name,
    x,
    z,
    heading,
    speed: 0,
    roll: 0,
    brakeGlow: 0,
    boost: 0,
});

const velocityOf = (ship) => [Math.sin(ship.heading) * ship.speed, -Math.cos(ship.heading) * ship.speed];

const setVelocity = (ship, vx, vz) => {
    ship.speed = Math.hypot(vx, vz);
    if (ship.speed > MIN_HEADING_SPEED) ship.heading += wrapAngle(Math.atan2(vx, -vz) - ship.heading);
};

const bounce = (ship, normalX, normalZ, restitution) => {
    const [vx, vz] = velocityOf(ship);
    const into = -(vx * normalX + vz * normalZ);
    if (into <= 0) return;
    setVelocity(ship, vx + (1 + restitution) * into * normalX, vz + (1 + restitution) * into * normalZ);
};

const confineToWalls = (ship, halfSize) => {
    const limit = halfSize - SHIP_RADIUS;
    if (Math.abs(ship.x) > limit) {
        const side = Math.sign(ship.x);
        ship.x = side * limit;
        bounce(ship, -side, 0, WALL_RESTITUTION);
    }
    if (Math.abs(ship.z) > limit) {
        const side = Math.sign(ship.z);
        ship.z = side * limit;
        bounce(ship, 0, -side, WALL_RESTITUTION);
    }
};

const pushOutOfObstacles = (ship, obstacles) => {
    for (const obstacle of obstacles) {
        const dx = ship.x - obstacle.x;
        const dz = ship.z - obstacle.z;
        const distance = Math.hypot(dx, dz);
        const reach = obstacle.radius + SHIP_RADIUS;
        if (distance >= reach) continue;

        const normalX = distance > 0 ? dx / distance : 1;
        const normalZ = distance > 0 ? dz / distance : 0;
        ship.x = obstacle.x + normalX * reach;
        ship.z = obstacle.z + normalZ * reach;
        bounce(ship, normalX, normalZ, OBSTACLE_RESTITUTION);
    }
};

const stepArenaShip = (ship, arena, steer, throttle, dt) => {
    const boosting = ship.boost > 0;
    const braking = throttle <= 0 && !boosting && ship.speed > 0;
    ship.brakeGlow = moveToward(ship.brakeGlow, braking ? 1 : 0, BRAKE_GLOW_RATE * dt);
    ship.boost = Math.max(0, ship.boost - dt);

    const topSpeed = arena.maxSpeed * (boosting ? BOOST_SPEED_FACTOR : 1);
    const thrust = throttle * ACCELERATION - (1 - throttle) * BRAKING + (boosting ? BOOST_ACCELERATION : 0);
    ship.speed = Math.max(0, ship.speed + thrust * dt);
    if (ship.speed > topSpeed) ship.speed = Math.max(topSpeed, ship.speed - OVERSPEED_DECAY * dt);

    const authority = clamp(ship.speed / TURN_SPEED_RAMP, 0, 1);
    ship.heading += steer * SHIPS[ship.name].steerRate * TURN_GAIN * authority * dt;

    const [vx, vz] = velocityOf(ship);
    ship.x += vx * dt;
    ship.z += vz * dt;
    confineToWalls(ship, arena.halfSize);
    pushOutOfObstacles(ship, arena.obstacles);

    ship.roll += (steer * ROLL_AT_FULL_STEER - ship.roll) * (1 - Math.exp(-TILT_RESPONSE * dt));
};

module.exports = { buildArena, buildArenas, createArenaShip, stepArenaShip, velocityOf, setVelocity };
