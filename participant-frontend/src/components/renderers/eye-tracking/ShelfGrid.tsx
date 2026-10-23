import React, { useCallback, useState } from 'react';

export interface ShelfGridProps {
    columns: string[];
    shelfCount: number;
    blur?: boolean;
    opacity?: number;
    className?: string;
    style?: React.CSSProperties;
    containerRef?: React.RefObject<HTMLDivElement | null>;
}

export const ShelfGrid: React.FC<ShelfGridProps> = ({
    columns,
    shelfCount,
    blur = false,
    opacity,
    className = '',
    style,
    containerRef,
}) => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const [cellAspect, setCellAspect] = useState(1);
    const gridAspect = (columns.length * cellAspect) / shelfCount;

    const handleFirstImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            setCellAspect(image.naturalWidth / image.naturalHeight);
        }
    }, []);

    if (columns.length === 0) return null;

    return (
        <div
            ref={containerRef}
            className={`mx-auto select-none ${className}`}
            style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
                gridTemplateRows: `repeat(${shelfCount}, 1fr)`,
                width: `min(85vw, calc(75vh * ${gridAspect}))`,
                aspectRatio: `${gridAspect}`,
                gap: isMobile ? 1 : 2,
                ...(blur ? { filter: 'blur(12px)' } : {}),
                ...(opacity != null ? { opacity } : {}),
                ...style,
            }}
        >
            {Array.from({ length: shelfCount * columns.length }, (_, i) => {
                const url = columns[i % columns.length];
                return (
                    <img
                        key={i}
                        src={url}
                        alt={`Shelf item ${i + 1}`}
                        className="w-full h-full min-w-0 min-h-0 object-contain"
                        draggable={false}
                        onLoad={i === 0 ? handleFirstImageLoad : undefined}
                    />
                );
            })}
        </div>
    );
};
