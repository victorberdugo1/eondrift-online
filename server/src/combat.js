'use strict';

const { SPELLS } = require('./content');
const { wrapDelta } = require('./collisions');
const { SHIP_RADIUS } = require('./ship');
const { moveToward } = require('./math');
const { PAD } = require('./track');
const { createFighter, tickFighter, isActive, defeat, castSpell, outgoingDamage, incomingDamage } = require('./fighter');

const createCombat = ({ config, track }) => {
    const { combat } = config;
    const dt = 1 / config.tickRate;
    const ticks = (seconds) => Math.round(seconds * config.tickRate);
    let shots = [];
    let nextShotId = 1;
    let defeats = 0;

    const nearestAhead = (shooter, players) => {
        let best = null;
        let bestGap = Infinity;
        for (const other of players) {
            if (other === shooter || !isActive(other)) continue;
            const gap = wrapDelta(other.sim.distance - shooter.sim.distance, track.length);
            if (gap > 0 && gap < bestGap) {
                best = other;
                bestGap = gap;
            }
        }
        return best;
    };

    const fire = (shooter, spell, projectile, players) => {
        const { sim } = shooter;
        const target = projectile.homing > 0 ? (nearestAhead(shooter, players)?.id ?? null) : null;
        for (const offset of projectile.barrels) {
            shots.push({
                id: nextShotId++,
                spell,
                owner: shooter.id,
                damage: outgoingDamage(combat, sim.name, projectile) * projectile.barrelDamageScale,
                distance: sim.distance,
                lateral: sim.lateral + offset,
                speed: sim.speed + projectile.speed,
                heading: projectile.homing > 0 ? 0 : sim.heading,
                age: 0,
                target,
            });
        }
    };

    const cast = (shooter, spell, players) => {
        const projectile = castSpell(shooter, spell, ticks);
        if (projectile) fire(shooter, spell, projectile, players);
    };

    const disable = (player) => {
        player.fighter.disabledTicks = ticks(combat.disabledSeconds);
        player.fighter.health = combat.maxHealth * combat.respawnHealthFraction;
        player.sim.speed = 0;
        player.sim.boost = 0;
    };

    const damage = (player, amount, slow) => {
        const taken = incomingDamage(combat, player.sim.name, amount);
        player.fighter.health -= taken;
        player.fighter.energy -= taken;
        player.sim.speed *= 1 - slow;
        if (player.fighter.energy <= 0) defeat(player, ++defeats);
        else if (player.fighter.health <= 0) disable(player);
    };

    const sweepsThrough = (shot, projectile, before, player) => {
        const reach = combat.shipHalfLength + projectile.radius;
        const start = wrapDelta(player.sim.distance - before, track.length);
        const end = start + player.sim.speed * dt - (shot.distance - before);
        const lengthwise = Math.max(start, end) >= -reach && Math.min(start, end) <= reach;
        return lengthwise && Math.abs(player.sim.lateral - shot.lateral) <= SHIP_RADIUS + projectile.radius;
    };

    const advance = (shot, players) => {
        const projectile = SPELLS[shot.spell].projectile;
        const before = shot.distance;
        shot.age += dt;
        if (projectile.homing > 0) {
            shot.distance += shot.speed * dt;
        } else {
            shot.heading += track.curvatureAt(shot.distance) * shot.speed * Math.cos(shot.heading) * dt;
            shot.distance += shot.speed * Math.cos(shot.heading) * dt;
            shot.lateral += shot.speed * Math.sin(shot.heading) * dt;
        }

        const target = players.find((player) => player.id === shot.target && isActive(player));
        if (target) shot.lateral = moveToward(shot.lateral, target.sim.lateral, projectile.homing * dt);

        const victim = players.find((player) => player.id !== shot.owner && isActive(player) && sweepsThrough(shot, projectile, before, player));
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
                tickFighter(player, combat, dt, track.onPad(player.sim.distance, player.sim.lateral, PAD.MAGIC) ? combat.magicPadPerSecond : 0);
                for (const spell of player.casts.splice(0)) cast(player, spell, players);
            }
            shots = shots.filter((shot) => advance(shot, players));
        },
        canDrive: (player) => player.fighter.disabledTicks === 0,
        shots: () => shots,
    };
};

module.exports = { createCombat };
