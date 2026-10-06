import React from 'react';

const RING_RADIUS = 16;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface DwellRingProps {
    startedAt: number | null;
    durationMs: number;
    colorClassName: string;
}

export const DwellRing: React.FC<DwellRingProps> = ({ startedAt, durationMs, colorClassName }) => {
    if (startedAt === null) return null;

    return (
        <svg
            key={startedAt}
            data-testid="dwell-ring"
            className={`pointer-events-none absolute -inset-3 ${colorClassName}`}
            viewBox="0 0 36 36"
        >
            <circle
                cx="18"
                cy="18"
                r={RING_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE}
                transform="rotate(-90 18 18)"
            >
                <animate
                    attributeName="stroke-dashoffset"
                    from={RING_CIRCUMFERENCE}
                    to="0"
                    dur={`${durationMs}ms`}
                    fill="freeze"
                />
            </circle>
        </svg>
    );
};
