'use strict';

const { Room } = require('./room');
const { ArenaRoom } = require('./arena_room');

const createMatchmaker = ({ config, tracks, arenas }) => {
    const rooms = new Map();
    const holds = new Map();
    let nextRoomId = 1;

    const stagesFor = (mode) => (mode === 'deathmatch' ? arenas : tracks);

    const openRoom = (mode) => {
        const candidates = [...rooms.values()].filter((room) => room.mode === mode && room.isOpen());
        return candidates.reduce((fullest, room) => (room.seats > fullest.seats ? room : fullest), candidates[0]);
    };

    const createRoom = (mode, owner) => {
        const options = { id: `r${nextRoomId++}`, mode, owner, config, onClose: (closed) => rooms.delete(closed.id) };
        const room = mode === 'deathmatch' ? new ArenaRoom(options) : new Room(options);
        rooms.set(room.id, room);
        return room;
    };

    const release = (connection) => {
        const room = holds.get(connection);
        holds.delete(connection);
        room?.unreserve(connection);
    };

    return {
        claim: (connection, mode) => {
            release(connection);
            const open = openRoom(mode);
            const room = open ?? createRoom(mode, connection);
            room.reserve(connection);
            holds.set(connection, room);
            return { role: open ? 'guest' : 'host', room };
        },
        release,
        canJoin: (connection, roomId, mode) => {
            const room = rooms.get(roomId);
            return room !== undefined && room.mode === mode && room.hasSeatFor(connection);
        },
        setStage: (connection, trackId) => {
            const room = holds.get(connection) ?? connection.player?.room;
            if (!room?.canSetStage(connection)) return 'not_host';
            const stages = stagesFor(room.mode);
            if (!Object.hasOwn(stages, trackId)) return 'unknown_track';
            room.setStage(trackId, stages[trackId]);
            return null;
        },
        join: (player, roomId) => {
            const room = rooms.get(roomId);
            if (holds.get(player.connection) === room) holds.delete(player.connection);
            else release(player.connection);
            room.add(player);
        },
        leave: (player) => player.room?.remove(player),
        step: () => {
            for (const room of rooms.values()) room.step();
        },
        roomCount: () => rooms.size,
    };
};

module.exports = { createMatchmaker };
