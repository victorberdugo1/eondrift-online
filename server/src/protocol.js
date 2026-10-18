'use strict';

const { SPELLS } = require('./content');

const TOKEN_MAX_LENGTH = 64;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const sanitizeName = (value, maxLength) => {
    const name = typeof value === 'string' ? value.replace(/\p{C}/gu, '').trim().slice(0, maxLength) : '';
    return name || 'Pilot';
};

const optionalString = (value) => (typeof value === 'string' ? value : null);

const parseMode = (value) => (value === 'deathmatch' || value === 'vs' ? value : 'race');

const parsers = {
    lobby: (message) => ({ t: 'lobby', mode: parseMode(message.mode) }),
    join: (message, { nameMaxLength }) => {
        const room = optionalString(message.room);
        if (room === null) return null;
        return {
            t: 'join',
            name: sanitizeName(message.name, nameMaxLength),
            ship: optionalString(message.ship),
            room,
            mode: parseMode(message.mode),
        };
    },
    stage: (message) => {
        const track = optionalString(message.track);
        return track === null ? null : { t: 'stage', track };
    },
    input: (message) => {
        if (!Number.isSafeInteger(message.seq) || message.seq < 0) return null;
        if (!Number.isFinite(message.steer) || !Number.isFinite(message.throttle)) return null;
        return {
            t: 'input',
            seq: message.seq,
            steer: clamp(message.steer, -1, 1),
            throttle: clamp(message.throttle, 0, 1),
        };
    },
    cast: (message) =>
        typeof message.spell === 'string' && Object.hasOwn(SPELLS, message.spell)
            ? { t: 'cast', spell: message.spell }
            : null,
    resume: (message) =>
        typeof message.token === 'string' && message.token.length > 0 && message.token.length <= TOKEN_MAX_LENGTH
            ? { t: 'resume', token: message.token }
            : null,
    ping: (message) => (Number.isFinite(message.ts) ? { t: 'ping', ts: message.ts } : null),
    leave: () => ({ t: 'leave' }),
};

const parse = (raw, config) => {
    let message;
    try {
        message = JSON.parse(raw);
    } catch {
        return null;
    }
    if (message === null || typeof message !== 'object' || typeof message.t !== 'string') return null;
    const parser = Object.hasOwn(parsers, message.t) ? parsers[message.t] : null;
    return parser ? parser(message, config) : null;
};

module.exports = { parse };
