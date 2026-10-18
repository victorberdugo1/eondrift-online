'use strict';

const { Room } = require('./room');
const { ArenaRoom } = require('./arena_room');

const createMatchmaker = ({ config, tracks, arenas }) => {
    const rooms = new Map();
    const claims = new Map();
    let nextRoomId = 1;

    const stagesFor = (mode) => (mode === 'deathmatch' ? arenas : tracks);

    const openRoom = (mode) => {
        const candidates = [...rooms.values()].filter((room) => room.mode === mode && room.isOpen());
        return candidates.reduce((fullest, room) => (room.players.size > fullest.players.size ? room : fullest), candidates[0]);
    };

    const createRoom = (trackId, mode) => {
        const options = { id: `r${nextRoomId++}`, trackId, mode, config, onClose: (closed) => rooms.delete(closed.id) };
        const room = mode === 'deathmatch' ? new ArenaRoom({ ...options, arena: arenas[trackId] }) : new Room({ ...options, track: tracks[trackId] });
        rooms.set(room.id, room);
        return room;
    };

    return {
        hasStage: (trackId, mode) => Object.hasOwn(stagesFor(mode), trackId),
        claim: (owner, mode) => {
            const room = openRoom(mode);
            if (room) {
                claims.delete(owner);
                return { role: 'guest', room };
            }
            const holder = [...claims].find(([, claimedMode]) => claimedMode === mode);
            if (holder && holder[0] !== owner) return { role: 'wait', room: null };
            claims.set(owner, mode);
            return { role: 'host', room: null };
        },
        release: (owner) => claims.delete(owner),
        canJoin: (roomId, mode) => {
            const room = rooms.get(roomId);
            return room !== undefined && room.mode === mode && room.isOpen();
        },
        host: (player, trackId, mode) => createRoom(trackId, mode).add(player),
        join: (player, roomId) => rooms.get(roomId).add(player),
        leave: (player) => player.room?.remove(player),
        step: () => {
            for (const room of rooms.values()) room.step();
        },
        roomCount: () => rooms.size,
    };
};

module.exports = { createMatchmaker };
