'use strict';

const { createShip, stepShip } = require('./ship');
const { createCombat } = require('./combat');
const { createCollisions } = require('./collisions');

const PHASE = Object.freeze({ LOBBY: 'lobby', COUNTDOWN: 'countdown', RUNNING: 'running' });

const round = (value, digits) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

const percent = (value, max) => Math.round((value / max) * 100);

class Room {
    constructor({ id, trackId, mode = 'race', track, arena, config, onClose }) {
        this.id = id;
        this.trackId = trackId;
        this.mode = mode;
        this.track = track;
        this.arena = arena;
        this.config = config;
        this.onClose = onClose;
        this.dt = 1 / config.tickRate;
        this.snapshotInterval = Math.round(config.tickRate / config.snapshotRate);
        this.players = new Map();
        this.phase = PHASE.LOBBY;
        this.phaseTicks = null;
        this.tick = 0;
        this.raceTick = 0;
        this.firstFinishTick = null;
        this.combat = this.createCombat();
        this.collisions = this.createCollisions();
    }

    createCombat() {
        return createCombat({ config: this.config, track: this.track });
    }

    createCollisions() {
        return createCollisions({ config: this.config, track: this.track });
    }

    get laps() {
        return this.track.laps;
    }

    ticks(seconds) {
        return Math.round(seconds * this.config.tickRate);
    }

    get maxPlayers() {
        return this.mode === 'vs' ? this.config.room.versusMaxPlayers : this.config.room.maxPlayers;
    }

    isOpen() {
        return this.phase === PHASE.LOBBY && this.players.size < this.maxPlayers;
    }

    add(player) {
        player.resetRace();
        player.room = this;
        this.players.set(player.id, player);
        this.syncLobbyTimer();
        this.broadcastRoom();
    }

    remove(player) {
        if (!this.players.delete(player.id)) return;
        player.room = null;
        player.resetRace();
        if (this.players.size === 0) return this.close();
        if (this.phase === PHASE.LOBBY) this.syncLobbyTimer();
        if (this.phase === PHASE.COUNTDOWN && this.players.size < this.config.room.minPlayers) this.abortCountdown();
        this.broadcastRoom();
        if (this.phase === PHASE.RUNNING) this.finishIfOver();
    }

    syncLobbyTimer() {
        const { minPlayers, lobbyFillSeconds, fullLobbySeconds } = this.config.room;
        const maxPlayers = this.maxPlayers;
        if (this.players.size < minPlayers) {
            this.phaseTicks = null;
            return;
        }
        const target = this.ticks(this.players.size >= maxPlayers ? fullLobbySeconds : lobbyFillSeconds);
        this.phaseTicks = this.phaseTicks === null ? target : Math.min(this.phaseTicks, target);
    }

    spawn(players) {
        const { gridSpacing } = this.config.room;
        players.forEach((player, slot) => {
            player.startLateral = (slot - (players.length - 1) / 2) * gridSpacing;
            player.sim = createShip(player.shipName, player.startLateral);
        });
    }

    startCountdown() {
        const players = [...this.players.values()];
        this.spawn(players);
        this.combat.start(players);
        this.phase = PHASE.COUNTDOWN;
        this.phaseTicks = this.ticks(this.config.room.countdownSeconds);
        this.raceTick = 0;
        this.firstFinishTick = null;
        this.broadcastRoom();
    }

    abortCountdown() {
        for (const player of this.players.values()) player.resetRace();
        this.phase = PHASE.LOBBY;
        this.phaseTicks = null;
    }

    startRace() {
        this.phase = PHASE.RUNNING;
        this.phaseTicks = null;
        this.broadcastRoom();
    }

    step() {
        this.tick++;
        if (this.phase === PHASE.LOBBY) return this.stepLobby();
        this.stepRace();
        if (this.phase === PHASE.COUNTDOWN && --this.phaseTicks <= 0) this.startRace();
    }

    stepLobby() {
        if (this.phaseTicks !== null && --this.phaseTicks <= 0) this.startCountdown();
    }

    stepRace() {
        const racing = this.phase === PHASE.RUNNING;
        const finishDistance = this.track.laps * this.track.length;

        const players = [...this.players.values()];
        if (racing) this.combat.step(players);

        for (const player of players) {
            const finished = player.finishTime !== null;
            const steer = finished ? 0 : player.input.steer;
            const driving = racing && !finished && this.combat.canDrive(player);
            const throttle = driving ? player.input.throttle : 0;
            const before = player.sim.distance;
            stepShip(player.sim, this.track, steer, throttle, this.dt);
            if (racing && !finished && player.sim.distance >= finishDistance) {
                const crossed = (finishDistance - before) / (player.sim.distance - before);
                player.finishTime = (this.raceTick + crossed) * this.dt;
                this.firstFinishTick ??= this.raceTick + 1;
            }
        }

        if (racing) this.collisions.resolve(players.filter((player) => player.finishTime === null && !player.fighter.defeated).map((player) => player.sim));
        if (racing) this.raceTick++;
        if (this.tick % this.snapshotInterval === 0) this.broadcastState();
        if (racing) this.finishIfOver();
    }

    finishIfOver() {
        const { finishGraceSeconds, raceTimeoutSeconds } = this.config.room;
        const players = [...this.players.values()];
        const everyoneFinished = players.every((player) => player.finishTime !== null || player.fighter.defeated);
        const lastStanding = players.length > 1 && players.filter((player) => !player.fighter.defeated).length <= 1;
        const graceOver = this.firstFinishTick !== null && this.raceTick - this.firstFinishTick >= this.ticks(finishGraceSeconds);
        if (everyoneFinished || lastStanding || graceOver || this.raceTick >= this.ticks(raceTimeoutSeconds)) this.finish();
    }

    ranking() {
        const players = [...this.players.values()];
        const finished = players.filter((player) => player.finishTime !== null).sort((a, b) => a.finishTime - b.finishTime);
        const unfinished = players.filter((player) => player.finishTime === null && !player.fighter.defeated).sort((a, b) => b.sim.distance - a.sim.distance);
        const defeated = players.filter((player) => player.fighter.defeated).sort((a, b) => b.fighter.defeatOrder - a.fighter.defeatOrder);
        return [...finished, ...unfinished, ...defeated].map((player) => ({
            id: player.id,
            time: player.finishTime === null ? null : round(player.finishTime, 3),
        }));
    }

    finish() {
        if (this.phase === PHASE.RUNNING) this.broadcastState();
        this.broadcast({ t: 'results', ranking: this.ranking() });
        for (const player of this.players.values()) {
            player.room = null;
            player.resetRace();
        }
        this.players.clear();
        this.close();
    }

    close() {
        this.onClose(this);
    }

    roomMessage() {
        const racing = this.phase !== PHASE.LOBBY;
        return {
            t: 'room',
            id: this.id,
            track: this.trackId,
            host: this.players.keys().next().value ?? null,
            mode: this.mode,
            laps: this.laps,
            phase: this.phase,
            endsIn: this.phaseTicks === null ? null : Math.round((this.phaseTicks / this.config.tickRate) * 1000),
            players: [...this.players.values()].map((player) => ({
                id: player.id,
                name: player.name,
                ship: player.shipName,
                lat: racing ? round(player.startLateral, 3) : undefined,
            })),
        };
    }

    broadcastRoom() {
        this.broadcast(this.roomMessage());
    }

    sendRoom(player) {
        player.send(this.roomMessage());
    }

    broadcast(message) {
        const text = JSON.stringify(message);
        for (const player of this.players.values()) player.sendRaw(text, false);
    }

    shipRows() {
        return [...this.players.values()].map(({ id, sim, finishTime, fighter }) => [
            id,
            round(sim.distance, 3),
            round(sim.lateral, 3),
            round(sim.heading, 4),
            round(sim.speed, 2),
            round(sim.roll, 4),
            round(sim.brakeGlow, 2),
            finishTime === null ? null : round(finishTime, 3),
            percent(fighter.health, this.config.combat.maxHealth),
            percent(fighter.energy, this.config.combat.maxEnergy),
        ]);
    }

    shotRows() {
        return this.combat
            .shots()
            .map(({ id, spell, distance, lateral, speed, heading, age }) => [id, spell, round(distance, 1), round(lateral, 1), Math.round(speed), round(heading, 3), round(age, 3)]);
    }

    broadcastState() {
        const ships = JSON.stringify(this.shipRows());
        const shots = JSON.stringify(this.shotRows());
        const head = `{"t":"state","tick":${this.raceTick},"ack":`;
        for (const player of this.players.values()) {
            player.sendRaw(`${head}${player.input.seq},"ships":${ships},"shots":${shots}}`, true);
        }
    }
}

module.exports = { Room, PHASE, round, percent };
