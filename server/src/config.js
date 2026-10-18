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
    snapshotRate: 30,
    maxPayloadBytes: 512,
    maxMessagesPerSecond: 200,
    maxSendBacklogBytes: 64 * 1024,
    heartbeatMs: 10000,
    joinTimeoutMs: 10000,
    lobbyTimeoutMs: 120000,
    resumeGraceMs: 15000,
    nameMaxLength: 16,
    combat: Object.freeze({
        maxHealth: 100,
        maxEnergy: 100,
        energyPerSecond: 12,
        disabledSeconds: 2,
        respawnHealthFraction: 0.5,
        referenceShield: 5,
        referenceAttack: 5,
        shipHalfLength: 3,
        castQueueLimit: 4,
    }),
    collision: Object.freeze({
        restitution: 0.3,
        headingKick: 0.08,
    }),
    room: Object.freeze({
        minPlayers: 2,
        maxPlayers: 8,
        lobbyFillSeconds: 10,
        fullLobbySeconds: 3,
        countdownSeconds: 3,
        finishGraceSeconds: 30,
        raceTimeoutSeconds: 600,
        gridSpacing: 4.5,
        versusMaxPlayers: 2,
        deathmatchTimeoutSeconds: 180,
    }),
});
