import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParticipantStore } from '../../stores/useParticipantStore';
import { mediaService } from '../../services/media.service';
import { useFaceApiEmotions } from '../../hooks/useFaceApiEmotions';
import { usePreviewMode } from '../../hooks/usePreviewMode';
import { useConsentRecorder } from '../../hooks/useConsentRecorder';
import { detectMicroExpressions } from '../../lib/eyeTracking';

interface EmotionAnalysisRendererProps {
    module: {
        id: string;
        name: string;
        structure?: { components?: Array<{ id?: string; type?: string; value?: unknown; placeholder?: { text?: string } }> };
    };
    onComplete?: () => void;
}

type Phase = 'intro' | 'setup' | 'viewing' | 'complete';

function extractConfig(module: EmotionAnalysisRendererProps['module']) {
    const comps = module.structure?.components ?? [];
    const get = (id: string) => comps.find(c => c.id === id);

    const stimuliComp = get('stimuli');
    let stimulusUrls: string[] = [];
    if (stimuliComp?.value) {
        try {
            const parsed = typeof stimuliComp.value === 'string' ? JSON.parse(stimuliComp.value) : stimuliComp.value;
            if (Array.isArray(parsed)) {
                stimulusUrls = parsed.map((img: { s3Key?: string; url?: string }) => img.s3Key || img.url || '').filter(Boolean);
            }
        } catch { /* empty */ }
    }

    const viewingTimeComp = get('viewing-time');
    const viewingDuration = Number(viewingTimeComp?.value || '10') * 1000;

    const taskComp = get('task-instructions');
    const taskDescription = (taskComp?.value as string) || taskComp?.placeholder?.text || '';

    const randomize = get('randomize-stimuli')?.value === 'true';

    return { stimulusUrls, viewingDuration, taskDescription, randomize };
}

export const EmotionAnalysisRenderer: React.FC<EmotionAnalysisRendererProps> = ({ module, onComplete }) => {
    const { t } = useTranslation();
    const { saveResponse } = useParticipantStore();
    const { isPreviewMode } = usePreviewMode();

    const { stimulusUrls, viewingDuration, taskDescription, randomize } = useMemo(() => extractConfig(module), [module]);

    const [phase, setPhase] = useState<Phase>('intro');
    const [currentIndex, setCurrentIndex] = useState(0);
    const [resolvedUrls, setResolvedUrls] = useState<string[]>([]);
    const [timeLeft, setTimeLeft] = useState(Math.ceil(viewingDuration / 1000));
    const [webcamReady, setWebcamReady] = useState(false);
    const savedRef = useRef(false);
    const webcamVideoRef = useRef<HTMLVideoElement>(null);
    const introRef = useRef<HTMLDivElement>(null);
    const [consentError, setConsentError] = useState<string | null>(null);
    const recordConsent = useConsentRecorder('emotion_analysis');

    const handleIntroContinue = useCallback(async () => {
        setConsentError(null);
        try {
            await recordConsent('accepted', introRef.current?.innerText ?? '');
            setPhase('setup');
        } catch (err) {
            console.error(err);
            setConsentError(t('eyeTracking.consent.recordFailed', 'We could not save your consent. Check your connection and try again.'));
        }
    }, [recordConsent, t]);
    const allSamplesRef = useRef<Array<{ stimulusIndex: number; samples: ReturnType<typeof faceEmotions.getSamples> }>>([]);

    const faceEmotions = useFaceApiEmotions({
        videoRef: webcamVideoRef,
        enabled: true,
        sampleIntervalMs: 50,
    });

    // Resolve media URLs
    useEffect(() => {
        let urls = stimulusUrls;
        if (randomize) {
            urls = [...urls];
            for (let i = urls.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [urls[i], urls[j]] = [urls[j], urls[i]];
            }
        }
        Promise.all(urls.map(key => mediaService.getMediaUrl(key))).then(setResolvedUrls);
    }, [stimulusUrls, randomize]);

    // Start webcam
    const startWebcam = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            });
            if (webcamVideoRef.current) {
                webcamVideoRef.current.srcObject = stream;
                await webcamVideoRef.current.play();
                setWebcamReady(true);
            }
        } catch (err) {
            console.error('[EmotionAnalysis] Webcam error:', err);
        }
    }, []);

    // Stop webcam
    const stopWebcam = useCallback(() => {
        const video = webcamVideoRef.current;
        if (video?.srcObject) {
            (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
            video.srcObject = null;
        }
    }, []);

    // Setup phase: start webcam
    useEffect(() => {
        if (phase === 'setup') {
            startWebcam();
        }
        return () => {
            if (phase === 'setup') stopWebcam();
        };
    }, [phase, startWebcam, stopWebcam]);

    // Viewing: timer countdown
    useEffect(() => {
        if (phase !== 'viewing') return;
        const seconds = Math.ceil(viewingDuration / 1000);
        setTimeLeft(seconds);

        const interval = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    // Save samples for current stimulus
                    const samples = faceEmotions.getSamples();
                    allSamplesRef.current.push({ stimulusIndex: currentIndex, samples });
                    faceEmotions.reset();

                    // Next stimulus or complete
                    if (currentIndex < resolvedUrls.length - 1) {
                        setCurrentIndex(prev => prev + 1);
                        setTimeLeft(seconds);
                    } else {
                        faceEmotions.stop();
                        stopWebcam();
                        setPhase('complete');
                    }
                    return seconds;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, currentIndex, viewingDuration, resolvedUrls.length]);

    // Start emotion recording when viewing begins
    useEffect(() => {
        if (phase === 'viewing' && faceEmotions.isLoaded) {
            faceEmotions.start();
        }
    }, [phase, faceEmotions]);

    // Save response on complete
    useEffect(() => {
        if (phase !== 'complete' || savedRef.current) return;
        savedRef.current = true;

        if (isPreviewMode) {
            onComplete?.();
            return;
        }

        const stimuliData = allSamplesRef.current.map(({ stimulusIndex, samples }) => ({
            stimulusIndex,
            stimulusUrl: stimulusUrls[stimulusIndex],
            emotionSamples: samples,
            microExpressions: detectMicroExpressions(samples),
            sampleCount: samples.length,
        }));

        const responseValue = JSON.stringify({
            stimuli: stimuliData,
            totalSamples: stimuliData.reduce((sum, s) => sum + s.sampleCount, 0),
            totalMicroExpressions: stimuliData.reduce((sum, s) => sum + s.microExpressions.length, 0),
        });

        saveResponse(module.id, 'emotion-analysis', responseValue);

        setTimeout(() => onComplete?.(), 1500);
    }, [phase, isPreviewMode, module.id, onComplete, saveResponse, stimulusUrls]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            faceEmotions.stop();
            stopWebcam();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (phase === 'intro') {
        return (
            <div className="fixed inset-0 bg-white flex items-center justify-center z-50">
                <div ref={introRef} className="max-w-md text-center space-y-6 px-6">
                    <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center mx-auto">
                        <svg className="w-8 h-8 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold text-gray-900">{t('Emotion Analysis')}</h2>
                    <p className="text-sm text-gray-600">
                        {taskDescription || t('Your webcam will record your facial expressions while you view the following stimuli. No images are stored — all processing happens on your device.')}
                    </p>
                    <p className="text-xs text-gray-400">
                        {resolvedUrls.length} {resolvedUrls.length === 1 ? 'stimulus' : 'stimuli'} &middot; {Math.ceil(viewingDuration / 1000)}s each
                    </p>
                    {consentError && <p className="text-sm text-red-500">{consentError}</p>}
                    <button
                        onClick={handleIntroContinue}
                        className="px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors"
                    >
                        {t('Continue')}
                    </button>
                </div>
            </div>
        );
    }

    if (phase === 'setup') {
        return (
            <div className="fixed inset-0 bg-white flex items-center justify-center z-50">
                <div className="max-w-md text-center space-y-6 px-6">
                    <h2 className="text-lg font-semibold text-gray-900">{t('Camera Setup')}</h2>
                    <p className="text-sm text-gray-600">{t('Position your face in the center of the frame')}</p>

                    <div className="w-64 h-48 bg-gray-800 rounded-xl mx-auto overflow-hidden relative">
                        <video
                            ref={webcamVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover scale-x-[-1]"
                        />
                        {!webcamReady && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => setPhase('viewing')}
                        disabled={!webcamReady || !faceEmotions.isLoaded}
                        className="px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
                    >
                        {!faceEmotions.isLoaded ? t('Loading models...') : t('Start')}
                    </button>
                </div>
            </div>
        );
    }

    if (phase === 'viewing') {
        const currentUrl = resolvedUrls[currentIndex];
        const isVideo = currentUrl && /\.(mp4|webm|ogg)(\?|$)/i.test(currentUrl);

        return (
            <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
                {/* Stimulus */}
                <div className="relative max-w-[90vw] max-h-[85vh]">
                    {isVideo ? (
                        <video
                            key={currentIndex}
                            src={currentUrl}
                            className="max-w-[90vw] max-h-[85vh] object-contain"
                            autoPlay
                            muted
                            playsInline
                        />
                    ) : (
                        <img
                            key={currentIndex}
                            src={currentUrl}
                            alt={`Stimulus ${currentIndex + 1}`}
                            className="max-w-[90vw] max-h-[85vh] object-contain"
                            draggable={false}
                        />
                    )}
                </div>

                {/* Timer + progress */}
                <div className="fixed top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 backdrop-blur-sm text-white px-4 py-2 rounded-full">
                    <span className="text-sm font-mono">{timeLeft}s</span>
                    <span className="text-xs text-white/60">
                        {currentIndex + 1} / {resolvedUrls.length}
                    </span>
                </div>

                {/* Hidden webcam (still capturing) */}
                <video ref={webcamVideoRef} className="hidden" autoPlay playsInline muted />
            </div>
        );
    }

    // Complete
    return (
        <div className="fixed inset-0 bg-white flex items-center justify-center z-50">
            <div className="text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                    <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <p className="text-lg font-medium text-gray-900">{t('Emotion analysis complete')}</p>
                <p className="text-sm text-gray-500">{t('Thank you for your participation')}</p>
            </div>
        </div>
    );
};
