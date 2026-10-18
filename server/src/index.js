'use strict';

const { createServer } = require('./server');

const server = createServer();

server.listen().then((port) => {
    console.log(`[eondrift] listening on :${port}`);
});

const shutdown = () => server.close().then(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
