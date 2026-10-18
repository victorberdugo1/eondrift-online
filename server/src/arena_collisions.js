'use strict';

const { SHIP_RADIUS } = require('./ship');
const { inverseMass } = require('./collisions');
const { velocityOf, setVelocity } = require('./arena');

const createArenaCollisions = ({ config }) => {
    const { restitution } = config.collision;
    const reach = 2 * SHIP_RADIUS;

    const collide = (a, b) => {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= reach) return;

        const normalX = distance > 0 ? dx / distance : 1;
        const normalZ = distance > 0 ? dz / distance : 0;
        const inverseA = inverseMass(a);
        const inverseB = inverseMass(b);
        const total = inverseA + inverseB;
        const overlap = reach - distance;
        a.x -= (normalX * overlap * inverseA) / total;
        a.z -= (normalZ * overlap * inverseA) / total;
        b.x += (normalX * overlap * inverseB) / total;
        b.z += (normalZ * overlap * inverseB) / total;

        const [ax, az] = velocityOf(a);
        const [bx, bz] = velocityOf(b);
        const closing = (ax - bx) * normalX + (az - bz) * normalZ;
        if (closing <= 0) return;

        const impulse = ((1 + restitution) * closing) / total;
        setVelocity(a, ax - impulse * inverseA * normalX, az - impulse * inverseA * normalZ);
        setVelocity(b, bx + impulse * inverseB * normalX, bz + impulse * inverseB * normalZ);
    };

    return {
        resolve: (ships) => {
            for (let i = 0; i < ships.length; i++) {
                for (let j = i + 1; j < ships.length; j++) collide(ships[i], ships[j]);
            }
        },
    };
};

module.exports = { createArenaCollisions };
