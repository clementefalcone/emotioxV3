import React from 'react';
import { StepProgressPill } from './StepProgressPill';
import { TOTAL_STEPS } from './types';
import type { ShelfConfig } from './types';
import { ShelfGrid } from './ShelfGrid';

interface ViewingPhaseProps {
    isVideo: boolean;
    resolvedUrl: string;
    viewingDuration: number;
    timeLeft: number;
    microDot: { u: number; v: number } | null;
    imgRef: React.RefObject<HTMLImageElement | null>;
    stimulusVideoRef: React.RefObject<HTMLVideoElement | null>;
    containerRef: React.RefObject<HTMLDivElement | null>;
    onImageLoad: () => void;
    onVideoLoadedMetadata: () => void;
    onVideoEnded?: () => void;
    shelfConfig: ShelfConfig | null;
}

export const ViewingPhase: React.FC<ViewingPhaseProps> = ({
    isVideo,
    resolvedUrl,
    viewingDuration,
    timeLeft,
    microDot,
    imgRef,
    stimulusVideoRef,
    containerRef,
    onImageLoad,
    onVideoLoadedMetadata,
    onVideoEnded,
    shelfConfig,
}) => {
    const viewingPercent = Math.round(70 + (1 - timeLeft / Math.ceil(viewingDuration / 1000)) * 30);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center select-none"
            style={{ background: '#ffffff' }}
        >
            <div className="pointer-events-none absolute left-1/2 z-[70] -translate-x-1/2" style={{ top: 'max(16px, env(safe-area-inset-top, 16px))' }}>
                <StepProgressPill step={4} total={TOTAL_STEPS} percent={viewingPercent} />
            </div>

            {/* Timer */}
            <div className="pointer-events-none absolute left-1/2 z-[70] -translate-x-1/2" style={{ top: 'max(64px, calc(env(safe-area-inset-top, 16px) + 48px))' }}>
                <span className={`text-lg font-mono font-bold ${
                    timeLeft <= 3 ? 'text-red-500' : 'text-gray-400'
                }`}>
                    {timeLeft}s
                </span>
            </div>

            {/* Stimulus container (image or video) */}
            <div
                ref={containerRef}
                className="relative"
                onContextMenu={(e) => e.preventDefault()}
                style={{ touchAction: 'none' }}
            >
                {shelfConfig ? (
                    <ShelfGrid
                        urls={shelfConfig.urls}
                        shelfCount={shelfConfig.shelfCount}
                        shelfItems={shelfConfig.shelfItems}
                        repetitions={shelfConfig.repetitions}
                        containerRef={shelfConfig.containerRef}
                        onAllLoaded={shelfConfig.onAllLoaded}
                        rotationInterval={shelfConfig.rotationInterval}
                    />
                ) : isVideo ? (
                    <video
                        ref={stimulusVideoRef}
                        src={resolvedUrl}
                        className="max-w-[100vw] max-h-[100vh] object-contain"
                        muted
                        playsInline
                        preload="auto"
                        onLoadedMetadata={onVideoLoadedMetadata}
                        onEnded={onVideoEnded}
                    />
                ) : (
                    <img
                        ref={imgRef}
                        src={resolvedUrl}
                        alt="Stimulus"
                        className="max-w-[100vw] max-h-[100vh] object-contain"
                        draggable={false}
                        onLoad={onImageLoad}
                    />
                )}
                {/* Micro-recalibration dot (nearly invisible, drift correction) */}
                {microDot && (
                    <div
                        className="absolute pointer-events-none rounded-full"
                        style={{
                            left: `${microDot.u * 100}%`,
                            top: `${microDot.v * 100}%`,
                            width: 4,
                            height: 4,
                            transform: 'translate(-50%, -50%)',
                            backgroundColor: 'rgba(120, 120, 120, 0.12)',
                        }}
                    />
                )}
            </div>

        </div>
    );
};
