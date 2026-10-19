'use strict';

const { SPELLS } = require('./content');
const { SHIP_RADIUS } = require('./ship');
const { clamp, wrapAngle } = require('./math');
const { createFighter, tickFighter, isActive, defeat, castSpell, outgoingDamage, incomingDamage } = require('./fighter');

const HOMING_CONE = Math.PI / 3;

const bearingTo = (from, to) => Math.atan2(to.x - from.x, -(to.z - from.z));

const distanceToSegment = (px, pz, ax, az, bx, bz) => {
    const sx = bx - ax;
    const sz = bz - az;
    const lengthSquared = sx * sx + sz * sz;
    const along = lengthSquared === 0 ? 0 : clamp(((px - ax) * sx + (pz - az) * sz) / lengthSquared, 0, 1);
    return Math.hypot(px - (ax + sx * along), pz - (az + sz * along));
};

const createArenaCombat = ({ config, arena }) => {
    const { combat } = config;
    const dt = 1 / config.tickRate;
    const ticks = (seconds) => Math.round(seconds * config.tickRate);
    let shots = [];
    let nextShotId = 1;
    let defeats = 0;

    const nearestInCone = (shooter, players) => {
        let best = null;
        let bestDistance = Infinity;
        for (const other of players) {
            if (other === shooter || !isActive(other)) continue;
            const offset = Math.abs(wrapAngle(bearingTo(shooter.sim, other.sim) - shooter.sim.heading));
            const distance = Math.hypot(other.sim.x - shooter.sim.x, other.sim.z - shooter.sim.z);
            if (offset <= HOMING_CONE && distance < bestDistance) {
                best = other;
                bestDistance = distance;
            }
        }
        return best;
    };

    const fire = (shooter, spell, projectile, players) => {
        const { sim } = shooter;
        const target = projectile.homing > 0 ? (nearestInCone(shooter, players)?.id ?? null) : null;
        const drop = projectile.drop ?? 0;
        for (const offset of projectile.barrels) {
            shots.push({
                id: nextShotId++,
                spell,
                owner: shooter.id,
                damage: outgoingDamage(combat, sim.name, projectile) * projectile.barrelDamageScale,
                x: sim.x + Math.cos(sim.heading) * offset - Math.sin(sim.heading) * drop,
                z: sim.z + Math.sin(sim.heading) * offset + Math.cos(sim.heading) * drop,
                speed: drop > 0 ? 0 : sim.speed + projectile.arenaSpeed,
                heading: sim.heading,
                age: 0,
                target,
            });
        }
    };

    const cast = (shooter, spell, players) => {
        const projectile = castSpell(shooter, spell, ticks);
        if (projectile) fire(shooter, spell, projectile, players);
    };

    const damage = (player, amount, slow) => {
        const taken = incomingDamage(combat, player.sim.name, amount);
        player.fighter.health -= taken;
        player.fighter.energy -= taken;
        player.sim.speed *= 1 - slow;
        if (player.fighter.health <= 0 || player.fighter.energy <= 0) defeat(player, ++defeats);
    };

    const isBlocked = (shot) =>
        Math.abs(shot.x) >= arena.halfSize ||
        Math.abs(shot.z) >= arena.halfSize ||
        arena.obstacles.some((obstacle) => Math.hypot(shot.x - obstacle.x, shot.z - obstacle.z) < obstacle.radius);

    const advance = (shot, players) => {
        const projectile = SPELLS[shot.spell].projectile;
        shot.age += dt;

        const target = players.find((player) => player.id === shot.target && isActive(player));
        if (target) {
            const maxTurn = projectile.arenaTurn * dt;
            shot.heading += clamp(wrapAngle(bearingTo(shot, target.sim) - shot.heading), -maxTurn, maxTurn);
        }

        const fromX = shot.x;
        const fromZ = shot.z;
        shot.x += Math.sin(shot.heading) * shot.speed * dt;
        shot.z -= Math.cos(shot.heading) * shot.speed * dt;
        if (isBlocked(shot)) return false;

        const reach = SHIP_RADIUS + projectile.radius;
        const victim = players.find(
            (player) =>
                player.id !== shot.owner &&
                isActive(player) &&
                distanceToSegment(player.sim.x, player.sim.z, fromX, fromZ, shot.x, shot.z) <= reach,
        );
        if (victim) damage(victim, shot.damage, projectile.slow);
        return !victim && shot.age < projectile.life;
    };

    return {
        start: (players) => {
            shots = [];
            defeats = 0;
            for (const player of players) player.fighter = createFighter(combat);
        },
        step: (players) => {
            for (const player of players) {
                tickFighter(player, combat, dt, combat.energyPerSecond);
                for (const spell of player.casts.splice(0)) cast(player, spell, players);
            }
            shots = shots.filter((shot) => advance(shot, players));
        },
        canDrive: (player) => player.fighter.disabledTicks === 0,
        shots: () => shots,
    };
};

module.exports = { createArenaCombat };
