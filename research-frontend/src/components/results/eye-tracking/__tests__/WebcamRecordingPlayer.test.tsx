import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebcamRecordingPlayer } from '../WebcamRecordingPlayer';

vi.mock('../../../../services/media.service', () => ({ resolveMediaUrl: (url: string) => url }));

describe('WebcamRecordingPlayer', () => {
  it('seeks the paused webcam video to the replay time minus the recording offset', () => {
    const { container, rerender } = render(
      <WebcamRecordingPlayer url="/media/a.webm" offsetMs={500} timeMs={2500} isPlaying={false} speed={1} />,
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.currentTime).toBe(2);

    rerender(<WebcamRecordingPlayer url="/media/a.webm" offsetMs={500} timeMs={200} isPlaying={false} speed={2} />);
    expect(video.currentTime).toBe(0);
    expect(video.playbackRate).toBe(2);
  });
});
