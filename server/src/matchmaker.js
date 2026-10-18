'use strict';

const { Room } = require('./room');

const createMatchmaker = ({ config, tracks }) => {
    const rooms = new Map();
    let nextRoomId = 1;

    const openRoom = (trackId, mode) => {
        const candidates = [...rooms.values()].filter((room) => room.trackId === trackId && room.mode === mode && room.isOpen());
        return candidates.reduce((fullest, room) => (room.players.size > fullest.players.size ? room : fullest), candidates[0]);
    };

    const createRoom = (trackId, mode) => {
        const room = new Room({
            id: `r${nextRoomId++}`,
            trackId,
            mode,
            track: tracks[trackId],
            config,
            onClose: (closed) => rooms.delete(closed.id),
        });
        rooms.set(room.id, room);
        return room;
    };

    return {
        defaultTrackId: Object.keys(tracks)[0],
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
