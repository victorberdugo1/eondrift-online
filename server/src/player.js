'use strict';

const { WebSocket } = require('ws');

const NEUTRAL_INPUT = Object.freeze({ steer: 0, throttle: 0 });
const PENDING_INPUT_LIMIT = 4;

class Player {
    constructor(id, token, backlogLimit) {
        this.id = id;
        this.token = token;
        this.backlogLimit = backlogLimit;
        this.name = '';
        this.shipName = '';
        this.connection = null;
        this.room = null;
        this.graceTimer = null;
        this.resetRace();
    }

    resetRace() {
        this.input = { seq: 0, ...NEUTRAL_INPUT };
        this.applied = { seq: 0, ...NEUTRAL_INPUT };
        this.pending = [];
        this.sim = null;
        this.fighter = null;
        this.casts = [];
        this.startLateral = 0;
        this.finishTime = null;
    }

    releaseControls() {
        Object.assign(this.input, NEUTRAL_INPUT);
        Object.assign(this.applied, NEUTRAL_INPUT);
        this.pending.length = 0;
    }

    applyInput({ seq, steer, throttle }) {
        if (seq <= this.input.seq) return;
        this.input = { seq, steer, throttle };
        this.pending.push(this.input);
        if (this.pending.length > PENDING_INPUT_LIMIT) this.pending.shift();
    }

    advanceInput() {
        const next = this.pending.shift();
        if (next) this.applied = next;
    }

    queueCast(spell, limit) {
        if (this.casts.length < limit) this.casts.push(spell);
    }

    send(message) {
        this.sendRaw(JSON.stringify(message), false);
    }

    sendRaw(text, droppable) {
        const socket = this.connection?.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        if (droppable && socket.bufferedAmount > this.backlogLimit) return;
        socket.send(text);
    }
}

module.exports = { Player };
