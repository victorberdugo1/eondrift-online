'use strict';

const { randomBytes } = require('node:crypto');
const { parse } = require('./protocol');
const { Player } = require('./player');
const { SHIPS } = require('./content');
const { PHASE } = require('./room');

const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_GOING_AWAY = 1001;
const RATE_WINDOW_MS = 1000;
const SHUTDOWN_GRACE_MS = 1000;

const createGateway = ({ config, matchmaker }) => {
    const connections = new Set();
    const playersByToken = new Map();
    let nextPlayerId = 1;

    const sendError = (connection, code) => connection.socket.send(JSON.stringify({ t: 'error', code }));

    const forget = (player) => {
        clearTimeout(player.graceTimer);
        matchmaker.leave(player);
        playersByToken.delete(player.token);
    };

    const attach = (connection, player) => {
        clearTimeout(player.graceTimer);
        const stale = player.connection;
        player.connection = connection;
        connection.player = player;
        if (stale) {
            stale.player = null;
            stale.socket.terminate();
        }
    };

    const welcome = (player, resumed) => {
        player.send({ t: 'joined', id: player.id, token: player.token, resumed });
    };

    const handleJoin = (connection, message) => {
        if (message.ship === null || !Object.hasOwn(SHIPS, message.ship)) return sendError(connection, 'unknown_ship');
        const trackId = message.track ?? matchmaker.defaultTrackId;
        if (!matchmaker.hasTrack(trackId)) return sendError(connection, 'unknown_track');
        if (connection.player?.room) return sendError(connection, 'already_in_room');

        let player = connection.player;
        if (!player) {
            player = new Player(nextPlayerId++, randomBytes(16).toString('hex'), config.maxSendBacklogBytes);
            playersByToken.set(player.token, player);
            attach(connection, player);
            welcome(player, false);
        }
        player.name = message.name;
        player.shipName = message.ship;
        matchmaker.join(player, trackId);
    };

    const handleResume = (connection, message) => {
        const player = playersByToken.get(message.token);
        if (connection.player || !player) return sendError(connection, 'unknown_token');
        attach(connection, player);
        welcome(player, true);
        player.room?.sendRoom(player);
    };

    const handlers = {
        ping: (connection, { ts }) => connection.socket.send(JSON.stringify({ t: 'pong', ts })),
        join: handleJoin,
        resume: handleResume,
        input: (connection, message) => {
            if (connection.player?.room) connection.player.applyInput(message);
        },
        cast: (connection, { spell }) => {
            const room = connection.player?.room;
            if (room?.phase === PHASE.RUNNING) connection.player.queueCast(spell, config.combat.castQueueLimit);
        },
        leave: (connection) => {
            if (connection.player) matchmaker.leave(connection.player);
        },
    };

    const withinRateLimit = (connection) => {
        const now = Date.now();
        if (now - connection.windowStart >= RATE_WINDOW_MS) {
            connection.windowStart = now;
            connection.windowCount = 0;
        }
        return ++connection.windowCount <= config.maxMessagesPerSecond;
    };

    const onMessage = (connection, data, isBinary) => {
        if (isBinary || !withinRateLimit(connection)) return connection.socket.close(CLOSE_POLICY_VIOLATION);
        const message = parse(data.toString(), config);
        if (!message) return sendError(connection, 'bad_message');
        handlers[message.t](connection, message);
    };

    const onClose = (connection) => {
        clearTimeout(connection.joinTimer);
        connections.delete(connection);
        const player = connection.player;
        if (!player) return;
        player.connection = null;
        player.releaseControls();
        if (player.room && player.room.phase !== PHASE.LOBBY) {
            player.graceTimer = setTimeout(() => forget(player), config.resumeGraceMs);
        } else {
            forget(player);
        }
    };

    const accept = (socket) => {
        const connection = {
            socket,
            player: null,
            alive: true,
            windowStart: Date.now(),
            windowCount: 0,
            joinTimer: setTimeout(() => {
                if (!connection.player) socket.close(CLOSE_POLICY_VIOLATION);
            }, config.joinTimeoutMs),
        };
        connections.add(connection);
        socket.on('pong', () => {
            connection.alive = true;
        });
        socket.on('message', (data, isBinary) => onMessage(connection, data, isBinary));
        socket.on('error', () => socket.terminate());
        socket.on('close', () => onClose(connection));
        socket.send(JSON.stringify({ t: 'hello', tickRate: config.tickRate, snapshotRate: config.snapshotRate }));
    };

    const heartbeat = () => {
        for (const connection of connections) {
            if (!connection.alive) {
                connection.socket.terminate();
                continue;
            }
            connection.alive = false;
            connection.socket.ping();
        }
    };

    return {
        accept,
        heartbeat,
        playerCount: () => playersByToken.size,
        shutdown: () => {
            for (const { socket } of connections) {
                socket.close(CLOSE_GOING_AWAY);
                setTimeout(() => socket.terminate(), SHUTDOWN_GRACE_MS).unref();
            }
            for (const player of playersByToken.values()) clearTimeout(player.graceTimer);
        },
    };
};

module.exports = { createGateway };
