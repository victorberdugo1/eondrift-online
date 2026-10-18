'use strict';

const http = require('node:http');
const { WebSocketServer } = require('ws');
const defaultConfig = require('./config');
const { TRACKS, ARENAS } = require('./content');
const { buildTracks } = require('./track');
const { buildArenas } = require('./arena');
const { createMatchmaker } = require('./matchmaker');
const { createGateway } = require('./gateway');
const { createLoop } = require('./loop');

const WS_PATH = '/ws';
const HEALTH_PATH = '/health';

const rejectUpgrade = (socket, status, reason) => {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
};

const clientIp = (req, trustProxy) => {
    const forwarded = trustProxy ? req.headers['x-forwarded-for'] : undefined;
    return forwarded ? forwarded.split(',').at(-1).trim() : req.socket.remoteAddress;
};

const createServer = ({ config = defaultConfig, tracks = buildTracks(TRACKS), arenas = buildArenas(ARENAS) } = {}) => {
    const matchmaker = createMatchmaker({ config, tracks, arenas });
    const gateway = createGateway({ config, matchmaker });
    const loop = createLoop(1000 / config.tickRate, matchmaker.step);
    const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });
    wss.on('connection', gateway.accept);
    const connectionsByIp = new Map();

    const httpServer = http.createServer((req, res) => {
        if (req.url !== HEALTH_PATH) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, rooms: matchmaker.roomCount(), players: gateway.playerCount() }));
    });

    httpServer.on('upgrade', (req, socket, head) => {
        if (new URL(req.url, 'http://localhost').pathname !== WS_PATH) return rejectUpgrade(socket, 404, 'Not Found');
        if (wss.clients.size >= config.maxConnections) return rejectUpgrade(socket, 503, 'Service Unavailable');
        const ip = clientIp(req, config.trustProxy);
        if ((connectionsByIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) return rejectUpgrade(socket, 429, 'Too Many Requests');
        wss.handleUpgrade(req, socket, head, (ws) => {
            connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
            ws.once('close', () => {
                const remaining = connectionsByIp.get(ip) - 1;
                if (remaining > 0) connectionsByIp.set(ip, remaining);
                else connectionsByIp.delete(ip);
            });
            wss.emit('connection', ws, req);
        });
    });

    let heartbeatTimer = null;

    return {
        matchmaker,
        listen: (port = config.port) =>
            new Promise((resolve) => {
                httpServer.listen(port, () => {
                    loop.start();
                    heartbeatTimer = setInterval(gateway.heartbeat, config.heartbeatMs);
                    resolve(httpServer.address().port);
                });
            }),
        close: () =>
            new Promise((resolve) => {
                loop.stop();
                clearInterval(heartbeatTimer);
                gateway.shutdown();
                wss.close(() => httpServer.close(() => resolve()));
                httpServer.closeAllConnections();
            }),
    };
};

module.exports = { createServer };
