import { useEffect, useRef } from 'react';
import { resolveMediaUrl } from '../../../services/media.service';

const MAX_DRIFT_SECONDS = 0.3;

interface WebcamRecordingPlayerProps {
  readonly url: string;
  readonly offsetMs: number;
  readonly timeMs: number;
  readonly isPlaying: boolean;
  readonly speed: number;
}

export function WebcamRecordingPlayer({ url, offsetMs, timeMs, isPlaying, speed }: WebcamRecordingPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const targetSeconds = Math.max(0, (timeMs - offsetMs) / 1000);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isPlaying) {
      video.pause();
      return;
    }
    video.play().catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'webcam_recording_play_failed', url, error: error instanceof Error ? error.message : String(error) }));
    });
  }, [isPlaying, url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isPlaying || Math.abs(video.currentTime - targetSeconds) > MAX_DRIFT_SECONDS) {
      video.currentTime = targetSeconds;
    }
  }, [targetSeconds, isPlaying]);

  return (
    <div className="flex flex-col gap-1">
      <video ref={videoRef} src={resolveMediaUrl(url)} muted playsInline preload="auto" className="block w-full rounded-lg border bg-black" />
      <span className="text-[11px] text-gray-400">Webcam del participante, sincronizada con el replay</span>
    </div>
  );
}
