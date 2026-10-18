'use strict';

const { SHIPS, SPELLS } = require('./content');

const createFighter = ({ maxHealth, maxEnergy }) => ({
    health: maxHealth,
    energy: maxEnergy,
    cooldowns: {},
    disabledTicks: 0,
    defeated: false,
    defeatOrder: 0,
});

const tickFighter = (player, combat, dt) => {
    const { fighter } = player;
    fighter.energy = Math.min(combat.maxEnergy, fighter.energy + combat.energyPerSecond * dt);
    fighter.disabledTicks = Math.max(0, fighter.disabledTicks - 1);
    for (const spell of Object.keys(fighter.cooldowns)) fighter.cooldowns[spell] = Math.max(0, fighter.cooldowns[spell] - 1);
};

const isActive = (player) => player.finishTime === null && !player.fighter.defeated && player.fighter.disabledTicks === 0;

const defeat = (player, order) => {
    player.fighter.health = 0;
    player.fighter.energy = 0;
    player.fighter.defeated = true;
    player.fighter.defeatOrder = order;
    player.fighter.disabledTicks = Number.MAX_SAFE_INTEGER;
    player.sim.boost = 0;
};

const castSpell = (player, spell, ticks) => {
    const spec = SPELLS[spell];
    const { fighter, sim } = player;
    if (!isActive(player) || fighter.energy < spec.cost || (fighter.cooldowns[spell] ?? 0) > 0) return null;

    fighter.energy -= spec.cost;
    fighter.cooldowns[spell] = ticks(spec.cooldown);
    if (!spec.projectile) {
        sim.boost = Math.max(sim.boost, spec.boost);
        return null;
    }
    return spec.projectile;
};

const outgoingDamage = (combat, shipName, projectile) => projectile.damage * (SHIPS[shipName].attack / combat.referenceAttack);

const incomingDamage = (combat, shipName, amount) => (amount * combat.referenceShield) / SHIPS[shipName].shield;

module.exports = { createFighter, tickFighter, isActive, defeat, castSpell, outgoingDamage, incomingDamage };
