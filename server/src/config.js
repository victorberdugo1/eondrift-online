'use strict';

const numberFromEnv = (name, fallback) => {
    const value = Number(process.env[name]);
    return process.env[name] !== undefined && Number.isFinite(value) ? value : fallback;
};

module.exports = Object.freeze({
    port: numberFromEnv('PORT', 3000),
    maxConnections: numberFromEnv('MAX_CONNECTIONS', 2000),
    maxConnectionsPerIp: numberFromEnv('MAX_CONNECTIONS_PER_IP', 20),
    trustProxy: process.env.TRUST_PROXY === '1',
    tickRate: 60,
    snapshotRate: 20,
    maxPayloadBytes: 512,
    maxMessagesPerSecond: 200,
    maxSendBacklogBytes: 64 * 1024,
    heartbeatMs: 10000,
    joinTimeoutMs: 10000,
    resumeGraceMs: 15000,
    nameMaxLength: 16,
    room: Object.freeze({
        minPlayers: 2,
        maxPlayers: 8,
        lobbyFillSeconds: 10,
        fullLobbySeconds: 3,
        countdownSeconds: 3,
        finishGraceSeconds: 30,
        raceTimeoutSeconds: 600,
        gridSpacing: 4.5,
    }),
});
