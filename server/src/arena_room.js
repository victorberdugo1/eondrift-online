'use strict';

const { Room, PHASE, round, percent } = require('./room');
const { createArenaShip, stepArenaShip } = require('./arena');
const { createArenaCombat } = require('./arena_combat');
const { createArenaCollisions } = require('./arena_collisions');

class ArenaRoom extends Room {
    applyLayout(arena) {
        this.arena = arena;
    }

    createCombat() {
        return createArenaCombat({ config: this.config, arena: this.arena });
    }

    createCollisions() {
        return createArenaCollisions({ config: this.config });
    }

    get laps() {
        return 0;
    }

    spawn(players) {
        const { spawns } = this.arena;
        players.forEach((player, slot) => {
            player.startLateral = 0;
            player.sim = createArenaShip(player.shipName, spawns[Math.floor((slot * spawns.length) / players.length)]);
        });
    }

    stepRace() {
        const racing = this.phase === PHASE.RUNNING;
        const players = [...this.players.values()];
        if (racing) this.combat.step(players);

        for (const player of players) {
            player.advanceInput();
            const driving = racing && this.combat.canDrive(player);
            stepArenaShip(player.sim, this.arena, driving ? player.applied.steer : 0, driving ? player.applied.throttle : 0, this.dt);
        }

        if (racing) {
            this.collisions.resolve(players.filter((player) => !player.fighter.defeated).map((player) => player.sim));
            this.raceTick++;
        }
        if (this.tick % this.snapshotInterval === 0) this.broadcastState();
        if (racing) this.finishIfOver();
    }

    finishIfOver() {
        const alive = [...this.players.values()].filter((player) => !player.fighter.defeated);
        if (alive.length <= 1 || this.raceTick >= this.ticks(this.config.room.deathmatchTimeoutSeconds)) this.finish();
    }

    ranking() {
        const standing = ({ fighter }) => (fighter.defeated ? fighter.defeatOrder - 1000 : fighter.health);
        return [...this.players.values()].sort((a, b) => standing(b) - standing(a)).map((player) => ({ id: player.id, time: null }));
    }

    shipRows() {
        return [...this.players.values()].map(({ id, sim, fighter }) => [
            id,
            round(sim.x, 2),
            round(sim.z, 2),
            round(sim.heading, 4),
            round(sim.speed, 2),
            round(sim.roll, 4),
            round(sim.brakeGlow, 2),
            null,
            percent(fighter.health, this.config.combat.maxHealth),
            percent(fighter.energy, this.config.combat.maxEnergy),
        ]);
    }

    shotRows() {
        return this.combat
            .shots()
            .map(({ id, spell, x, z, speed, heading, age, owner }) => [id, spell, round(x, 1), round(z, 1), Math.round(speed), round(heading, 3), round(age, 3), owner]);
    }
}

module.exports = { ArenaRoom };
