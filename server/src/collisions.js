'use strict';

const { SHIPS } = require('./content');
const { SHIP_RADIUS } = require('./ship');

const wrapDelta = (delta, length) => delta - Math.round(delta / length) * length;

const clamp = (value, limit) => Math.min(Math.max(value, -limit), limit);

const inverseMass = (ship) => 1 / SHIPS[ship.name].shield;

const push = (first, second, overlap, axis) => {
    const total = inverseMass(first) + inverseMass(second);
    first[axis] -= (overlap * inverseMass(first)) / total;
    second[axis] += (overlap * inverseMass(second)) / total;
};

const exchangeSpeed = (rear, front, restitution) => {
    const closing = rear.speed - front.speed;
    if (closing <= 0) return;
    const rearMass = 1 / inverseMass(rear);
    const frontMass = 1 / inverseMass(front);
    const impulse = (1 + restitution) * closing * ((rearMass * frontMass) / (rearMass + frontMass));
    rear.speed -= impulse / rearMass;
    front.speed += impulse / frontMass;
};

const createCollisions = ({ config, track }) => {
    const { shipHalfLength } = config.combat;
    const { restitution, headingKick } = config.collision;
    const wallLimit = track.width * 0.5 - SHIP_RADIUS;

    const bumpSideways = (a, b, overlap, direction) => {
        push(a, b, overlap * direction, 'lateral');
        a.lateral = clamp(a.lateral, wallLimit);
        b.lateral = clamp(b.lateral, wallLimit);
        a.heading -= direction * headingKick;
        b.heading += direction * headingKick;
    };

    const bumpLengthwise = (a, b, overlap, ahead) => {
        const [rear, front] = ahead >= 0 ? [a, b] : [b, a];
        push(rear, front, overlap, 'distance');
        exchangeSpeed(rear, front, restitution);
    };

    const collide = (a, b) => {
        const ahead = wrapDelta(b.distance - a.distance, track.length);
        const side = b.lateral - a.lateral;
        const overlapLength = 2 * shipHalfLength - Math.abs(ahead);
        const overlapSide = 2 * SHIP_RADIUS - Math.abs(side);
        if (overlapLength <= 0 || overlapSide <= 0) return;

        if (overlapSide / (2 * SHIP_RADIUS) <= overlapLength / (2 * shipHalfLength)) {
            bumpSideways(a, b, overlapSide, Math.sign(side) || 1);
        } else {
            bumpLengthwise(a, b, overlapLength, ahead);
        }
    };

    return {
        resolve: (ships) => {
            for (let i = 0; i < ships.length; i++) {
                for (let j = i + 1; j < ships.length; j++) collide(ships[i], ships[j]);
            }
        },
    };
};

module.exports = { createCollisions, inverseMass, wrapDelta };
