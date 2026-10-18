'use strict';

const { WebSocket } = require('ws');
const config = require('../src/config');
const { buildTrack } = require('../src/track');
const { Player } = require('../src/player');

const CIRCLE_POINTS = Array.from({ length: 8 }, (_, i) => [
    Math.cos((i / 8) * 2 * Math.PI) * 40,
    0,
    Math.sin((i / 8) * 2 * Math.PI) * 40,
]);

const fastConfig = Object.freeze({
    ...config,
    room: Object.freeze({ ...config.room, lobbyFillSeconds: 0.2, fullLobbySeconds: 0.2, countdownSeconds: 0.2, finishGraceSeconds: 1 }),
    resumeGraceMs: 500,
});

const circleTrack = buildTrack({ controlPoints: CIRCLE_POINTS, width: 36, laps: 1 });

const fakePlayer = (id, ship, inbox = []) => {
    const player = new Player(id, `token-${id}`, Infinity);
    player.name = `pilot${id}`;
    player.shipName = ship;
    player.connection = { socket: { readyState: WebSocket.OPEN, bufferedAmount: 0, send: (text) => inbox.push(JSON.parse(text)) } };
    return player;
};

const connect = (port, headers = {}) =>
    new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
        const inbox = [];
        const waiters = [];
        socket.on('message', (data) => {
            const message = JSON.parse(data.toString());
            inbox.push(message);
            for (const waiter of [...waiters]) waiter.check();
        });
        const client = {
            socket,
            inbox,
            send: (message) => socket.send(JSON.stringify(message)),
            waitFor: (predicate, timeoutMs = 5000) =>
                new Promise((resolveWait, rejectWait) => {
                    const waiter = {
                        check: () => {
                            const found = inbox.find(predicate);
                            if (!found) return;
                            waiters.splice(waiters.indexOf(waiter), 1);
                            clearTimeout(timer);
                            resolveWait(found);
                        },
                    };
                    const timer = setTimeout(() => {
                        waiters.splice(waiters.indexOf(waiter), 1);
                        rejectWait(new Error('timed out waiting for message'));
                    }, timeoutMs);
                    waiters.push(waiter);
                    waiter.check();
                }),
            close: () => new Promise((resolveClose) => {
                if (socket.readyState === WebSocket.CLOSED) return resolveClose();
                socket.once('close', resolveClose);
                socket.close();
            }),
        };
        socket.once('open', () => resolve(client));
        socket.once('error', reject);
    });

module.exports = { fastConfig, circleTrack, fakePlayer, connect };
