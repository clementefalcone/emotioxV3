import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StepProgressPill } from './StepProgressPill';
import { TOTAL_STEPS } from './types';
import { evaluateFacePosition, type FacePosition } from './facePosition';

interface FacePositionPhaseProps {
    cameraRef: React.RefObject<HTMLVideoElement | null>;
    landmarksRef: React.RefObject<Array<{ x: number; y: number; z: number }> | null>;
    headPoseRef: React.RefObject<{ pitch: number; yaw: number }>;
    onContinue: () => void;
}

export const FacePositionPhase: React.FC<FacePositionPhaseProps> = ({ cameraRef, landmarksRef, headPoseRef, onContinue }) => {
    const { t } = useTranslation();
    const previewRef = useRef<HTMLVideoElement>(null);
    const [position, setPosition] = useState<FacePosition>('noFace');

    useEffect(() => {
        if (previewRef.current) previewRef.current.srcObject = cameraRef.current?.srcObject ?? null;
    }, [cameraRef]);

    useEffect(() => {
        let raf = 0;
        const track = () => {
            const camera = cameraRef.current;
            const frame = { width: camera?.videoWidth ?? 0, height: camera?.videoHeight ?? 0 };
            setPosition(evaluateFacePosition(landmarksRef.current, headPoseRef.current, frame));
            raf = requestAnimationFrame(track);
        };
        raf = requestAnimationFrame(track);
        return () => cancelAnimationFrame(raf);
    }, [cameraRef, landmarksRef, headPoseRef]);

    const isPositioned = position === 'ok';
    const instructions: Record<FacePosition, string> = {
        noFace: t('eyeTracking.face.noFace', 'Put your face in front of the camera'),
        center: t('eyeTracking.face.center', 'Move your face to the middle of the circle'),
        moveCloser: t('eyeTracking.face.moveCloser', 'Move a little closer'),
        moveBack: t('eyeTracking.face.moveBack', 'Move back a little'),
        lookStraight: t('eyeTracking.face.lookStraight', 'Look straight at the screen'),
        ok: t('eyeTracking.face.ok', 'Face centered · you can continue'),
    };

    return (
        <div className="flex flex-col items-center px-4 py-8">
            <StepProgressPill step={1} total={TOTAL_STEPS} percent={15} />

            <div className="w-full max-w-lg flex flex-col items-center gap-5 mt-6 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                    {t('eyeTracking.face.eyebrow', 'Getting ready')}
                </p>
                <h2 className="text-2xl font-bold text-gray-900">
                    {t('eyeTracking.face.title', 'Position your face')}
                </h2>
                <p className="text-gray-600">
                    {t('eyeTracking.face.description', 'Place your face inside the circle and look at the middle of the screen. It will turn green when you are centered.')}
                </p>

                <div className={`relative w-64 h-64 rounded-full overflow-hidden border-4 bg-gray-800 transition-colors ${isPositioned ? 'border-green-500' : 'border-red-400'}`}>
                    <video
                        ref={previewRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                        style={{ transform: 'scaleX(-1)' }}
                    />
                    <div className={`absolute inset-6 rounded-full border-2 transition-colors ${isPositioned ? 'border-green-400' : 'border-white/60'}`} />
                    <div className="absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                </div>

                <p className={`text-sm font-medium ${isPositioned ? 'text-green-600' : 'text-red-500'}`}>
                    {instructions[position]}
                </p>

                <button
                    onClick={onContinue}
                    disabled={!isPositioned}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-full font-medium hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {t('eyeTracking.face.continue', 'Continue')}
                </button>
            </div>
        </div>
    );
};
