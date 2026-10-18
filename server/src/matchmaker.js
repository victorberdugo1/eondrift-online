'use strict';

const { Room } = require('./room');
const { ArenaRoom } = require('./arena_room');

const createMatchmaker = ({ config, tracks, arenas }) => {
    const rooms = new Map();
    let nextRoomId = 1;

    const openRoom = (trackId, mode) => {
        const candidates = [...rooms.values()].filter((room) => room.trackId === trackId && room.mode === mode && room.isOpen());
        return candidates.reduce((fullest, room) => (room.players.size > fullest.players.size ? room : fullest), candidates[0]);
    };

    const createRoom = (trackId, mode) => {
        const options = { id: `r${nextRoomId++}`, trackId, mode, config, onClose: (closed) => rooms.delete(closed.id) };
        const room = mode === 'deathmatch' ? new ArenaRoom({ ...options, arena: arenas[trackId] }) : new Room({ ...options, track: tracks[trackId] });
        rooms.set(room.id, room);
        return room;
    };

    return {
        defaultTrackId: Object.keys(tracks)[0],
        defaultArenaId: Object.keys(arenas)[0],
        hasTrack: (trackId) => Object.hasOwn(tracks, trackId),
        join: (player, trackId, mode = 'race') => (openRoom(trackId, mode) ?? createRoom(trackId, mode)).add(player),
        leave: (player) => player.room?.remove(player),
        step: () => {
            for (const room of rooms.values()) room.step();
        },
        roomCount: () => rooms.size,
    };
};

module.exports = { createMatchmaker };
