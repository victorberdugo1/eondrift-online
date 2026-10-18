'use strict';

const { WebSocket } = require('ws');

const NEUTRAL_INPUT = Object.freeze({ steer: 0, throttle: 0 });

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
        this.sim = null;
        this.fighter = null;
        this.casts = [];
        this.startLateral = 0;
        this.finishTime = null;
    }

    releaseControls() {
        Object.assign(this.input, NEUTRAL_INPUT);
    }

    applyInput({ seq, steer, throttle }) {
        if (seq > this.input.seq) this.input = { seq, steer, throttle };
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
