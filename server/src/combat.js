'use strict';

const { SHIPS, SPELLS } = require('./content');
const { wrapDelta } = require('./collisions');
const { SHIP_RADIUS } = require('./ship');

const moveToward = (value, target, maxDelta) => {
    const delta = target - value;
    return Math.abs(delta) <= maxDelta ? target : value + Math.sign(delta) * maxDelta;
};

const createFighter = ({ maxHealth, maxEnergy }) => ({
    health: maxHealth,
    energy: maxEnergy,
    cooldowns: {},
    disabledTicks: 0,
});

const createCombat = ({ config, track }) => {
    const { combat } = config;
    const dt = 1 / config.tickRate;
    const ticks = (seconds) => Math.round(seconds * config.tickRate);
    let shots = [];
    let nextShotId = 1;

    const isActive = (player) => player.finishTime === null && player.fighter.disabledTicks === 0;

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

    const fire = (shooter, spell, players) => {
        const { sim } = shooter;
        shots.push({
            id: nextShotId++,
            spell,
            owner: shooter.id,
            damage: SPELLS[spell].projectile.damage * (SHIPS[sim.name].attack / combat.referenceAttack),
            distance: sim.distance,
            lateral: sim.lateral,
            speed: sim.speed + SPELLS[spell].projectile.speed,
            age: 0,
            target: SPELLS[spell].projectile.homing > 0 ? (nearestAhead(shooter, players)?.id ?? null) : null,
        });
    };

    const cast = (shooter, spell, players) => {
        const spec = SPELLS[spell];
        const { fighter, sim } = shooter;
        if (!isActive(shooter) || fighter.energy < spec.cost || (fighter.cooldowns[spell] ?? 0) > 0) return;

        fighter.energy -= spec.cost;
        fighter.cooldowns[spell] = ticks(spec.cooldown);
        if (spec.boost) sim.boost = Math.max(sim.boost, spec.boost);
        else fire(shooter, spell, players);
    };

    const tickFighter = (player) => {
        const { fighter } = player;
        fighter.energy = Math.min(combat.maxEnergy, fighter.energy + combat.energyPerSecond * dt);
        fighter.disabledTicks = Math.max(0, fighter.disabledTicks - 1);
        for (const spell of Object.keys(fighter.cooldowns)) fighter.cooldowns[spell] = Math.max(0, fighter.cooldowns[spell] - 1);
    };

    const disable = (player) => {
        player.fighter.disabledTicks = ticks(combat.disabledSeconds);
        player.fighter.health = combat.maxHealth * combat.respawnHealthFraction;
        player.sim.speed = 0;
        player.sim.boost = 0;
    };

    const damage = (player, amount) => {
        player.fighter.health -= (amount * combat.referenceShield) / SHIPS[player.sim.name].shield;
        if (player.fighter.health <= 0) disable(player);
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
        shot.distance += shot.speed * dt;

        const target = players.find((player) => player.id === shot.target && isActive(player));
        if (target) shot.lateral = moveToward(shot.lateral, target.sim.lateral, projectile.homing * dt);

        const victim = players.find((player) => player.id !== shot.owner && isActive(player) && sweepsThrough(shot, projectile, before, player));
        if (victim) damage(victim, shot.damage);
        return !victim && shot.age < projectile.life;
    };

    return {
        start: (players) => {
            shots = [];
            for (const player of players) player.fighter = createFighter(combat);
        },
        step: (players) => {
            for (const player of players) {
                tickFighter(player);
                for (const spell of player.casts.splice(0)) cast(player, spell, players);
            }
            shots = shots.filter((shot) => advance(shot, players));
        },
        canDrive: (player) => player.fighter.disabledTicks === 0,
        shots: () => shots,
    };
};

module.exports = { createCombat };
