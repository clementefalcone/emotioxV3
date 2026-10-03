import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';

const MODELS_DIR = resolve(__dirname, '../../../public/models');
const FACE_API_MODELS = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_expression_model'];
const BYTES_PER_DTYPE: Record<string, number> = { float32: 4, int32: 4, uint16: 2, float16: 2, uint8: 1 };

interface ManifestWeight {
    shape: number[];
    dtype?: string;
    quantization?: { dtype: string };
}

const expectedBytes = (weights: ManifestWeight[]) =>
    weights.reduce((sum, w) => {
        const values = w.shape.reduce((n, dim) => n * dim, 1);
        return sum + values * BYTES_PER_DTYPE[w.quantization?.dtype ?? w.dtype ?? 'float32'];
    }, 0);

describe('face-api model files', () => {
    it.each(FACE_API_MODELS)('%s weights match the size declared by its manifest', (model) => {
        const manifest: { paths: string[]; weights: ManifestWeight[] }[] = JSON.parse(
            readFileSync(resolve(MODELS_DIR, `${model}-weights_manifest.json`), 'utf-8'),
        );
        for (const group of manifest) {
            const actualBytes = group.paths.reduce((sum, file) => sum + statSync(resolve(MODELS_DIR, file)).size, 0);
            expect(actualBytes).toBe(expectedBytes(group.weights));
        }
    });
});
