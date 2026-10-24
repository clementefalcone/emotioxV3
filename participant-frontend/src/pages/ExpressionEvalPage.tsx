import { useEffect, useRef, useState } from 'react';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createFaceLandmarker } from '../lib/eyeTracking/faceLandmarker';
import { createActionUnitEstimator } from '../lib/eyeTracking';
import { detectFaceWithExpressions, ensureModelsLoaded } from '../hooks/useFaceApiEmotions';
import { blendshapesToActionUnits, type ActionUnitValues } from '../lib/expressionEval/blendshapeActionUnits';
import { reportEngine, type EngineReport, type EngineSample, type RecordedSegment } from '../lib/expressionEval/metrics';
import type { ActionUnitId } from '../lib/expressionEval/protocol';

const ACTION_UNITS: ActionUnitId[] = ['AU1', 'AU2', 'AU4', 'AU6', 'AU12', 'AU15', 'AU20', 'AU25', 'AU26'];

interface EvalResult {
  dataset: string;
  processedFrames: number;
  engines: { faceApi: EngineReport; mediaPipe: EngineReport };
}

declare global {
  interface Window {
    __expressionEval?: { result: EvalResult; samples: { faceApi: EngineSample[]; mediaPipe: EngineSample[] } } | { error: string };
  }
}

async function measureFrame(video: HTMLVideoElement, landmarker: FaceLandmarker, estimate: ReturnType<typeof createActionUnitEstimator>, tMs: number) {
  const detection = await detectFaceWithExpressions(video);
  const faceApiValues: ActionUnitValues | null = detection ? estimate(detection.landmarks.positions) : null;
  const landmarks = landmarker.detectForVideo(video, tMs);
  const categories = landmarks.faceBlendshapes?.[0]?.categories;
  const mediaPipeValues = categories
    ? blendshapesToActionUnits(Object.fromEntries(categories.map(category => [category.categoryName, category.score])))
    : null;
  return { faceApi: { tMs, values: faceApiValues }, mediaPipe: { tMs, values: mediaPipeValues } };
}

function formatNumber(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}

function formatRate(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function ExpressionEvalPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dataset = new URLSearchParams(window.location.search).get('dataset') ?? '';
  const [status, setStatus] = useState('Cargando modelos…');
  const [result, setResult] = useState<EvalResult | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !dataset) return;
    let isCancelled = false;

    const run = async () => {
      const groundTruthResponse = await fetch(`/eval/datasets/${dataset}/ground-truth.json`);
      if (!groundTruthResponse.ok) throw new Error(`ground-truth.json not found for dataset "${dataset}" (HTTP ${groundTruthResponse.status})`);
      const { segments } = await groundTruthResponse.json() as { segments: RecordedSegment[] };
      await ensureModelsLoaded();
      if (isCancelled) return;
      const landmarker = await createFaceLandmarker(true);
      if (isCancelled) {
        landmarker.close();
        return;
      }
      const estimate = createActionUnitEstimator();
      const faceApiSamples: EngineSample[] = [];
      const mediaPipeSamples: EngineSample[] = [];

      await new Promise<void>((resolve, reject) => {
        video.onerror = () => reject(new Error(`video.webm could not be decoded for dataset "${dataset}"`));
        video.onended = () => resolve();
        let lastMediaTime = -1;
        const onFrame = async (_now: number, frame: VideoFrameCallbackMetadata) => {
          if (isCancelled) return;
          video.pause();
          if (frame.mediaTime <= lastMediaTime) {
            resolve();
            return;
          }
          lastMediaTime = frame.mediaTime;
          const samples = await measureFrame(video, landmarker, estimate, Math.round(frame.mediaTime * 1000));
          faceApiSamples.push(samples.faceApi);
          mediaPipeSamples.push(samples.mediaPipe);
          setStatus(`Procesando · ${frame.mediaTime.toFixed(1)} s · ${faceApiSamples.length} cuadros`);
          video.requestVideoFrameCallback(onFrame);
          await video.play();
        };
        video.requestVideoFrameCallback(onFrame);
        video.src = `/eval/datasets/${dataset}/video.webm`;
        void video.play();
      });
      landmarker.close();

      const evalResult: EvalResult = {
        dataset,
        processedFrames: faceApiSamples.length,
        engines: {
          faceApi: reportEngine(faceApiSamples, segments, ACTION_UNITS),
          mediaPipe: reportEngine(mediaPipeSamples, segments, ACTION_UNITS),
        },
      };
      window.__expressionEval = { result: evalResult, samples: { faceApi: faceApiSamples, mediaPipe: mediaPipeSamples } };
      setResult(evalResult);
      setStatus('Listo');
    };

    run().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      window.__expressionEval = { error: message };
      setStatus(`Error: ${message}`);
    });
    return () => { isCancelled = true; };
  }, [dataset]);

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900 flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Evaluación de expresiones · {dataset || 'sin dataset'}</h1>
        <p className="text-sm text-slate-500">{dataset ? status : 'Agrega ?dataset=<carpeta en eval/datasets>'}</p>
      </header>
      <video ref={videoRef} className="w-64 rounded border border-slate-300" muted playsInline />
      {result && (['faceApi', 'mediaPipe'] as const).map(engine => (
        <section key={engine} className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-2 overflow-x-auto">
          <h2 className="font-semibold">
            {engine === 'faceApi' ? 'face-api (producción)' : 'MediaPipe blendshapes'} · cara encontrada {formatRate(result.engines[engine].faceFoundRate)}
          </h2>
          <table className="text-xs">
            <thead>
              <tr className="text-slate-500">
                {['AU', 'Ruido neutro', 'Suave', 'Medio', 'Máximo', 'Señal/ruido', 'Monotonía', 'Especificidad', 'Giro cabeza', 'Dif. rondas', 'Saturación'].map(header => (
                  <th key={header} className="px-2 py-1 text-right first:text-left font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.engines[engine].units.map(unit => (
                <tr key={unit.unit} className="border-t border-slate-100 text-right font-mono">
                  <td className="px-2 py-1 text-left">{unit.unit}</td>
                  <td className="px-2 py-1">{formatNumber(unit.neutralSd, 3)}</td>
                  <td className="px-2 py-1">{formatNumber(unit.responseByIntensity.suave)}</td>
                  <td className="px-2 py-1">{formatNumber(unit.responseByIntensity.medio)}</td>
                  <td className="px-2 py-1">{formatNumber(unit.responseByIntensity.maximo)}</td>
                  <td className="px-2 py-1">{formatNumber(unit.signalToNoiseAtMaximum, 1)}</td>
                  <td className="px-2 py-1">{formatRate(unit.monotonicRate)}</td>
                  <td className="px-2 py-1">{formatNumber(unit.specificityAtMaximum, 1)}</td>
                  <td className="px-2 py-1">{formatNumber(unit.headPoseFalseActivation, 1)}</td>
                  <td className="px-2 py-1">{formatNumber(unit.retestDifference)}</td>
                  <td className="px-2 py-1">{formatRate(unit.saturationRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
