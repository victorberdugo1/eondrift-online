'use strict';

const MAX_CATCH_UP_STEPS = 5;

const createLoop = (stepMs, step) => {
    let timer = null;
    let previous = 0;
    let accumulator = 0;

    const frame = () => {
        const now = performance.now();
        accumulator += now - previous;
        previous = now;

        for (let steps = 0; accumulator >= stepMs && steps < MAX_CATCH_UP_STEPS; steps++) {
            step();
            accumulator -= stepMs;
        }
        if (accumulator >= stepMs) accumulator = 0;

        timer = setTimeout(frame, Math.max(1, stepMs - accumulator));
    };

    return {
        start() {
            previous = performance.now();
            accumulator = 0;
            timer = setTimeout(frame, stepMs);
        },
        stop() {
            clearTimeout(timer);
            timer = null;
        },
    };
};

module.exports = { createLoop };
