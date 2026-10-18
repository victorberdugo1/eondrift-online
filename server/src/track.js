'use strict';

const DENSE_PER_SEGMENT = 256;
const SAMPLE_STEP = 2;
const SMOOTH_HALF_WINDOW_LENGTH = 16;
const SMOOTH_PASSES = 3;
const WORLD_UP = [0, 1, 0];

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const normalize = (a) => {
    const length = Math.hypot(a[0], a[1], a[2]);
    return length === 0 ? a : scale(a, 1 / length);
};

const catmullRom = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
};

const wrap = (index, count) => ((index % count) + count) % count;

const splinePoint = (points, segment, t) => {
    const count = points.length;
    const p0 = points[wrap(segment - 1, count)];
    const p1 = points[wrap(segment, count)];
    const p2 = points[wrap(segment + 1, count)];
    const p3 = points[wrap(segment + 2, count)];
    return [0, 1, 2].map((axis) => catmullRom(p0[axis], p1[axis], p2[axis], p3[axis], t));
};

const buildDensePath = (controlPoints) => {
    const count = controlPoints.length * DENSE_PER_SEGMENT;
    const dense = Array.from({ length: count }, (_, i) =>
        splinePoint(controlPoints, Math.floor(i / DENSE_PER_SEGMENT), (i % DENSE_PER_SEGMENT) / DENSE_PER_SEGMENT));
    const cumulative = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) {
        cumulative[i + 1] = cumulative[i] + distance(dense[i], dense[(i + 1) % count]);
    }
    return { dense, cumulative };
};

const resamplePositions = ({ dense, cumulative }, count, step) => {
    const positions = [];
    let segment = 0;
    for (let i = 0; i < count; i++) {
        const target = i * step;
        while (segment < dense.length - 1 && cumulative[segment + 1] < target) segment++;
        const span = cumulative[segment + 1] - cumulative[segment];
        const t = span > 0 ? (target - cumulative[segment]) / span : 0;
        positions.push(lerp(dense[segment], dense[(segment + 1) % dense.length], t));
    }
    return positions;
};

const smoothPositions = (positions, step) => {
    const count = positions.length;
    const half = Math.round(SMOOTH_HALF_WINDOW_LENGTH / step);
    let current = positions;
    for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
        const previous = current;
        current = previous.map((_, i) => {
            let sum = [0, 0, 0];
            for (let k = -half; k <= half; k++) sum = add(sum, previous[wrap(i + k, count)]);
            return scale(sum, 1 / (2 * half + 1));
        });
    }
    return current;
};

const frameOf = (forward) => {
    const normalized = normalize(forward);
    const right = normalize(cross(normalized, WORLD_UP));
    return { forward: normalized, up: cross(right, normalized) };
};

const computeCurvatures = (positions, step) => {
    const count = positions.length;
    const frames = positions.map((_, i) =>
        frameOf(subtract(positions[(i + 1) % count], positions[wrap(i - 1, count)])));
    return Float64Array.from(frames, (frame, i) => {
        const turn = cross(frames[wrap(i - 1, count)].forward, frames[(i + 1) % count].forward);
        return dot(turn, frame.up) / (2 * step);
    });
};

const buildTrack = ({ controlPoints, width, laps }) => {
    const path = buildDensePath(controlPoints);
    const length = path.cumulative[path.dense.length];
    const count = Math.round(length / SAMPLE_STEP);
    const step = length / count;
    const curvatures = computeCurvatures(smoothPositions(resamplePositions(path, count, step), step), step);

    const curvatureAt = (along) => {
        const wrapped = ((along % length) + length) % length;
        const position = wrapped / step;
        const index = Math.min(Math.floor(position), count - 1);
        return catmullRom(
            curvatures[wrap(index - 1, count)],
            curvatures[index],
            curvatures[wrap(index + 1, count)],
            curvatures[wrap(index + 2, count)],
            position - index,
        );
    };

    return Object.freeze({ length, width, laps, curvatureAt });
};

const buildTracks = (defs) =>
    Object.fromEntries(Object.entries(defs).map(([id, def]) => [id, buildTrack(def)]));

module.exports = { buildTrack, buildTracks };
