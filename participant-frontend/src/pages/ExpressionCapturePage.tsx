import { useCallback, useEffect, useRef, useState } from 'react';
import { buildExpressionProtocol, PROTOCOL_VERSION, type ProtocolStep } from '../lib/expressionEval/protocol';

interface RecordedSegment extends ProtocolStep {
  startMs: number;
  endMs: number;
}

type Phase = 'idle' | 'countdown' | 'recording' | 'complete';

const COUNTDOWN_S = 3;
const PROTOCOL = buildExpressionProtocol();
const PROTOCOL_DURATION_S = Math.round(PROTOCOL.reduce((sum, step) => sum + step.durationMs, 0) / 1000);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadJson(value: unknown, fileName: string): void {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), fileName);
}

const INTENSITY_LABELS: Record<string, string> = { suave: 'Suave', medio: 'Medio', maximo: 'Máximo' };

export function ExpressionCapturePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [countdown, setCountdown] = useState(COUNTDOWN_S);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [currentStep, setCurrentStep] = useState<{ step: ProtocolStep; index: number } | null>(null);
  const [segments, setSegments] = useState<RecordedSegment[]>([]);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [cameraSettings, setCameraSettings] = useState<MediaTrackSettings | null>(null);

  useEffect(() => {
    let isCancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(async stream => {
        if (isCancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraSettings(stream.getVideoTracks()[0]?.getSettings() ?? null);
        setIsCameraReady(true);
      })
      .catch((error: unknown) => {
        if (!isCancelled) setCameraError(`getUserMedia failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => { isCancelled = true; };
  }, []);

  const startCapture = useCallback(async () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    if (!stream) return;
    setPhase('countdown');
    for (let second = COUNTDOWN_S; second > 0; second--) {
      setCountdown(second);
      await sleep(1000);
    }

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm',
    });
    recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
    const recordingStartedAt = await new Promise<number>(resolve => {
      recorder.onstart = () => resolve(performance.now());
      recorder.start(100);
    });
    setPhase('recording');

    const recorded: RecordedSegment[] = [];
    for (const [index, step] of PROTOCOL.entries()) {
      setCurrentStep({ step, index });
      const startMs = Math.round(performance.now() - recordingStartedAt);
      await sleep(step.durationMs);
      recorded.push({ ...step, startMs, endMs: Math.round(performance.now() - recordingStartedAt) });
    }

    setCurrentStep(null);
    await new Promise<void>(resolve => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    setVideoBlob(new Blob(chunks, { type: 'video/webm' }));
    setSegments(recorded);
    setPhase('complete');
  }, []);

  const downloadAll = useCallback(() => {
    if (!videoBlob) return;
    downloadBlob(videoBlob, 'expression-capture.webm');
    downloadJson({ protocolVersion: PROTOCOL_VERSION, segments }, 'ground-truth.json');
    downloadJson({
      name: `expression-capture-${new Date().toISOString().slice(0, 19)}`,
      protocolVersion: PROTOCOL_VERSION,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      videoWidth: videoRef.current?.videoWidth ?? 0,
      videoHeight: videoRef.current?.videoHeight ?? 0,
      cameraSettings,
      durationMs: segments.at(-1)?.endMs ?? 0,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      timingNote: 'Segment times are measured from MediaRecorder start; the first encoded frame can lag it by tens of ms.',
      conversionNote: 'ffmpeg -i expression-capture.webm -pix_fmt yuv420p video.y4m',
    }, 'metadata.json');
  }, [videoBlob, segments, cameraSettings]);

  const step = currentStep?.step;
  const isExpressionStep = step?.kind === 'expression' || step?.kind === 'head-pose';

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-3">
        <h1 className="text-lg font-semibold">Captura de expresiones</h1>
        <p className="text-xs text-slate-500">Graba tu cara siguiendo instrucciones con tiempos exactos. El video queda solo en tu equipo.</p>
      </header>

      <video
        ref={videoRef}
        className={`fixed z-50 top-20 right-4 rounded-lg object-cover bg-black border border-slate-300 shadow ${phase === 'recording' ? 'w-32 h-24' : 'w-48 h-36'}`}
        style={{ transform: 'scaleX(-1)' }}
        autoPlay
        muted
        playsInline
      />

      <main className="flex-1 flex flex-col items-center justify-center gap-6 p-6 text-center">
        {phase === 'idle' && (
          <div className="flex flex-col items-center gap-4 max-w-md">
            <p className="text-slate-600">
              Verás una instrucción a la vez: un gesto y su intensidad (suave, medio, máximo), seguido de cara relajada.
              El protocolo se repite dos veces y termina con giros de cabeza.
            </p>
            <p className="text-sm text-slate-500">Duración: unos {Math.ceil(PROTOCOL_DURATION_S / 60)} minutos. Mantén la cara dentro del recuadro y buena luz de frente.</p>
            {!isCameraReady && !cameraError && <p className="text-sm text-amber-600">Iniciando cámara…</p>}
            {cameraError && <p className="text-sm text-red-600">{cameraError}</p>}
            <button
              type="button"
              onClick={startCapture}
              disabled={!isCameraReady}
              className="px-8 py-3 rounded-lg bg-[#006AFF] text-white font-medium disabled:bg-slate-300"
            >
              Iniciar captura
            </button>
          </div>
        )}

        {phase === 'countdown' && <p className="text-6xl font-bold text-[#006AFF]">{countdown}</p>}

        {phase === 'recording' && step && currentStep && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-slate-400">Paso {currentStep.index + 1} de {PROTOCOL.length} · Ronda {step.round || '—'}</p>
            <p className={`font-semibold ${isExpressionStep ? 'text-3xl text-slate-900' : 'text-2xl text-slate-400'}`}>{step.instruction}</p>
            {step.intensity && <p className="text-xl font-medium text-[#006AFF]">{INTENSITY_LABELS[step.intensity]}</p>}
            <div className="w-64 h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div key={currentStep.index} className="h-full bg-[#006AFF]" style={{ animation: `expression-step ${step.durationMs}ms linear forwards` }} />
            </div>
            <style>{'@keyframes expression-step { from { width: 0% } to { width: 100% } }'}</style>
          </div>
        )}

        {phase === 'complete' && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-xl font-semibold text-green-700">Captura completa</p>
            <p className="text-sm text-slate-500">{segments.length} segmentos · {Math.round((segments.at(-1)?.endMs ?? 0) / 1000)} s</p>
            <button type="button" onClick={downloadAll} className="px-6 py-2 rounded-lg bg-[#006AFF] text-white font-medium">
              Descargar video y etiquetas (3 archivos)
            </button>
            <p className="text-xs text-slate-500">Guárdalos en participant-frontend/eval/datasets/expressions-&lt;fecha&gt;/</p>
          </div>
        )}
      </main>
    </div>
  );
}
