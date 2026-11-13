import React, { useState, useRef, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { AoiThumbnail } from './AoiThumbnail';

export interface AOI {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface AOIDrawerProps {
    imageUrl: string;
    aois: AOI[];
    onChange: (aois: AOI[]) => void;
    maxHeight?: number;
    renderAoiDetails?: (aoi: AOI) => React.ReactNode;
}

type DragMode = 'draw' | 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-w' | 'resize-e';
const HANDLE_SIZE = 1.5;
const MIN_SIZE = 2;

export const AOIDrawer: React.FC<AOIDrawerProps> = ({
    imageUrl,
    aois,
    onChange,
    maxHeight = 500,
    renderAoiDetails,
}) => {
    const [drawing, setDrawing] = useState(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
    const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [dragMode, setDragMode] = useState<DragMode | null>(null);
    const [dragAoiId, setDragAoiId] = useState<string | null>(null);
    const [dragAoiOriginal, setDragAoiOriginal] = useState<AOI | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const getMousePercent = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
        const el = containerRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
            y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
        };
    }, []);

    const getHandleAtPoint = useCallback((pos: { x: number; y: number }): { aoiId: string; mode: DragMode } | null => {
        for (let i = aois.length - 1; i >= 0; i--) {
            const a = aois[i];
            const corners: Array<{ mode: DragMode; cx: number; cy: number }> = [
                { mode: 'resize-nw', cx: a.x, cy: a.y },
                { mode: 'resize-ne', cx: a.x + a.width, cy: a.y },
                { mode: 'resize-sw', cx: a.x, cy: a.y + a.height },
                { mode: 'resize-se', cx: a.x + a.width, cy: a.y + a.height },
            ];
            for (const c of corners) {
                if (Math.abs(pos.x - c.cx) < HANDLE_SIZE * 2 && Math.abs(pos.y - c.cy) < HANDLE_SIZE * 2) {
                    return { aoiId: a.id, mode: c.mode };
                }
            }
            const edges: Array<{ mode: DragMode; hit: boolean }> = [
                { mode: 'resize-n', hit: Math.abs(pos.y - a.y) < HANDLE_SIZE && pos.x > a.x && pos.x < a.x + a.width },
                { mode: 'resize-s', hit: Math.abs(pos.y - (a.y + a.height)) < HANDLE_SIZE && pos.x > a.x && pos.x < a.x + a.width },
                { mode: 'resize-w', hit: Math.abs(pos.x - a.x) < HANDLE_SIZE && pos.y > a.y && pos.y < a.y + a.height },
                { mode: 'resize-e', hit: Math.abs(pos.x - (a.x + a.width)) < HANDLE_SIZE && pos.y > a.y && pos.y < a.y + a.height },
            ];
            for (const edge of edges) {
                if (edge.hit) return { aoiId: a.id, mode: edge.mode };
            }
            if (pos.x > a.x && pos.x < a.x + a.width && pos.y > a.y && pos.y < a.y + a.height) {
                return { aoiId: a.id, mode: 'move' };
            }
        }
        return null;
    }, [aois]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const pos = getMousePercent(e);
        if (!pos) return;

        if (drawing) {
            setDragMode('draw');
            setDragStart(pos);
            setDragCurrent({ x: pos.x, y: pos.y, w: 0, h: 0 });
            return;
        }

        const hit = getHandleAtPoint(pos);
        if (hit) {
            e.preventDefault();
            setDragMode(hit.mode);
            setDragAoiId(hit.aoiId);
            setDragStart(pos);
            setDragAoiOriginal(aois.find(a => a.id === hit.aoiId) || null);
        }
    }, [drawing, getMousePercent, getHandleAtPoint, aois]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!dragStart || !dragMode) return;
        const pos = getMousePercent(e);
        if (!pos) return;

        if (dragMode === 'draw') {
            setDragCurrent({
                x: Math.min(dragStart.x, pos.x),
                y: Math.min(dragStart.y, pos.y),
                w: Math.abs(pos.x - dragStart.x),
                h: Math.abs(pos.y - dragStart.y),
            });
            return;
        }

        if (!dragAoiOriginal || !dragAoiId) return;
        const dx = pos.x - dragStart.x;
        const dy = pos.y - dragStart.y;
        const o = dragAoiOriginal;

        let updated: Partial<AOI>;
        if (dragMode === 'move') {
            updated = {
                x: Math.max(0, Math.min(100 - o.width, o.x + dx)),
                y: Math.max(0, Math.min(100 - o.height, o.y + dy)),
            };
        } else {
            let nx = o.x, ny = o.y, nw = o.width, nh = o.height;
            if (dragMode.includes('w')) { nx = o.x + dx; nw = o.width - dx; }
            if (dragMode.includes('e')) { nw = o.width + dx; }
            if (dragMode.includes('n')) { ny = o.y + dy; nh = o.height - dy; }
            if (dragMode.includes('s')) { nh = o.height + dy; }
            if (nw < MIN_SIZE) { nw = MIN_SIZE; if (dragMode.includes('w')) nx = o.x + o.width - MIN_SIZE; }
            if (nh < MIN_SIZE) { nh = MIN_SIZE; if (dragMode.includes('n')) ny = o.y + o.height - MIN_SIZE; }
            nx = Math.max(0, nx);
            ny = Math.max(0, ny);
            updated = { x: nx, y: ny, width: nw, height: nh };
        }

        onChange(aois.map(a => a.id === dragAoiId ? { ...a, ...updated } : a));
    }, [dragStart, dragMode, dragAoiOriginal, dragAoiId, getMousePercent, aois, onChange]);

    const handleMouseUp = useCallback(() => {
        if (dragMode === 'draw' && dragCurrent && dragCurrent.w >= 1 && dragCurrent.h >= 1) {
            const newAoi: AOI = {
                id: `aoi_${crypto.randomUUID()}`,
                label: `AOI #${aois.length + 1}`,
                x: dragCurrent.x,
                y: dragCurrent.y,
                width: dragCurrent.w,
                height: dragCurrent.h,
            };
            onChange([...aois, newAoi]);
            setDrawing(false);
        }
        setDragStart(null);
        setDragCurrent(null);
        setDragMode(null);
        setDragAoiId(null);
        setDragAoiOriginal(null);
    }, [dragMode, dragCurrent, aois, onChange]);

    const cursorForMode = (mode: DragMode | null): string => {
        if (!mode) return '';
        const map: Record<string, string> = {
            move: 'cursor-move', draw: 'cursor-crosshair',
            'resize-nw': 'cursor-nwse-resize', 'resize-se': 'cursor-nwse-resize',
            'resize-ne': 'cursor-nesw-resize', 'resize-sw': 'cursor-nesw-resize',
            'resize-n': 'cursor-ns-resize', 'resize-s': 'cursor-ns-resize',
            'resize-w': 'cursor-ew-resize', 'resize-e': 'cursor-ew-resize',
        };
        return map[mode] || '';
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={() => setDrawing(prev => !prev)}
                    className={cn(
                        'px-3 py-1.5 text-xs font-medium rounded transition-colors',
                        drawing
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                >
                    {drawing ? 'Drawing AOI...' : '+ Add AOI'}
                </button>
                {aois.length > 0 && (
                    <span className="text-xs text-gray-500">
                        {aois.length} AOI{aois.length !== 1 ? 's' : ''} — drag to move, corners to resize
                    </span>
                )}
            </div>

            <div
                ref={containerRef}
                className={cn(
                    'relative rounded-lg overflow-hidden border bg-gray-100 w-fit max-w-full select-none',
                    drawing ? 'cursor-crosshair' : dragMode ? cursorForMode(dragMode) : ''
                )}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <img
                    src={imageUrl}
                    alt="Stimulus"
                    className="block max-w-full h-auto"
                    style={{ maxHeight }}
                    draggable={false}
                />

                <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                >
                    {aois.map(aoi => (
                        <g key={aoi.id}>
                            <rect
                                x={aoi.x} y={aoi.y}
                                width={aoi.width} height={aoi.height}
                                fill="rgba(59, 130, 246, 0.1)"
                                stroke="#3B82F6"
                                strokeWidth="0.4"
                            />
                            <text
                                x={aoi.x + 0.5} y={aoi.y + 2.5}
                                fill="#1D4ED8" fontSize="2.5" fontWeight="bold"
                            >
                                {aoi.label}
                            </text>
                            {[
                                { cx: aoi.x, cy: aoi.y },
                                { cx: aoi.x + aoi.width, cy: aoi.y },
                                { cx: aoi.x, cy: aoi.y + aoi.height },
                                { cx: aoi.x + aoi.width, cy: aoi.y + aoi.height },
                            ].map((h, i) => (
                                <rect
                                    key={i}
                                    x={h.cx - HANDLE_SIZE / 2} y={h.cy - HANDLE_SIZE / 2}
                                    width={HANDLE_SIZE} height={HANDLE_SIZE}
                                    fill="white" stroke="#3B82F6" strokeWidth="0.3"
                                />
                            ))}
                        </g>
                    ))}
                    {dragCurrent && dragMode === 'draw' && dragCurrent.w > 0 && (
                        <rect
                            x={dragCurrent.x} y={dragCurrent.y}
                            width={dragCurrent.w} height={dragCurrent.h}
                            fill="rgba(59, 130, 246, 0.15)"
                            stroke="#3B82F6"
                            strokeWidth="0.4"
                            strokeDasharray="1,1"
                        />
                    )}
                </svg>
            </div>

            {aois.length > 0 && (
                <div className="space-y-2">
                    {aois.map(aoi => (
                        <div key={aoi.id} className="flex items-center gap-3 p-2.5 bg-white border border-gray-200 rounded-lg">
                            <div className="w-14 h-10 rounded overflow-hidden flex-shrink-0 border bg-gray-50">
                                <AoiThumbnail imageUrl={imageUrl} aoi={aoi} alt={aoi.label} />
                            </div>
                            <span className={cn('text-sm font-medium text-gray-900 min-w-0 truncate', renderAoiDetails ? 'w-32 flex-shrink-0' : 'flex-1')}>
                                {aoi.label}
                            </span>
                            {renderAoiDetails && <div className="flex flex-1 justify-center min-w-0">{renderAoiDetails(aoi)}</div>}
                            <span className="text-xs text-gray-400">
                                {Math.round(aoi.width)}% x {Math.round(aoi.height)}%
                            </span>
                            <button
                                type="button"
                                onClick={() => onChange(aois.filter(a => a.id !== aoi.id))}
                                className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                                title="Remove AOI"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
