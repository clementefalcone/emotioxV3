import { useEffect, useState } from 'react';
import { loadCachedStimulusImage } from '../../utils/stimulusImageCache';

interface AoiThumbnailProps {
  readonly imageUrl: string;
  readonly aoi: { x: number; y: number; width: number; height: number };
  readonly alt: string;
}

export function AoiThumbnail({ imageUrl, aoi, alt }: AoiThumbnailProps) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let isCancelled = false;
    setNaturalSize(null);
    loadCachedStimulusImage(imageUrl)
      .then(img => {
        if (!isCancelled) setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      })
      .catch(() => {
        if (!isCancelled) setNaturalSize(null);
      });
    return () => { isCancelled = true; };
  }, [imageUrl]);

  if (!naturalSize) return null;

  const toPxX = (percent: number) => (percent / 100) * naturalSize.width;
  const toPxY = (percent: number) => (percent / 100) * naturalSize.height;

  return (
    <svg
      role="img"
      aria-label={alt}
      className="block w-full h-full"
      viewBox={`${toPxX(aoi.x)} ${toPxY(aoi.y)} ${toPxX(aoi.width)} ${toPxY(aoi.height)}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <image href={imageUrl} width={naturalSize.width} height={naturalSize.height} />
    </svg>
  );
}
