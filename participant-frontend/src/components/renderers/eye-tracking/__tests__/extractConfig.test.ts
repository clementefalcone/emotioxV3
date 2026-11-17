import { describe, it, expect } from 'vitest';
import { extractConfig, isCalibrationAccurate } from '../types';
import type { ModuleConfig } from '../../../../types/module';

/** Helper to build a minimal module config with given components. */
function makeModule(components: Array<{ id: string; type?: string; value?: string }>): ModuleConfig {
    return {
        id: 'mod-1',
        name: 'Eye Tracking',
        order: 1,
        structure: {
            components: components.map((c, i) => ({
                id: c.id,
                type: c.type || 'select',
                label: c.id,
                order: i,
                value: c.value,
            })),
        },
    } as unknown as ModuleConfig;
}

describe('extractConfig — shelf mode fields', () => {
    it('returns stand_alone defaults when no shelf components present', () => {
        const mod = makeModule([
            { id: 'stimuli', type: 'file-upload', value: JSON.stringify([{ s3Key: 'img1.jpg' }]) },
        ]);
        const config = extractConfig(mod);

        expect(config.displayMode).toBe('stand_alone');
        expect(config.shelfCount).toBe(2);
        expect(config.shelfItems).toBe(5);
        expect(config.randomizeStimuli).toBe(false);
        expect(config.isVideo).toBe(false);
    });

    it('extracts shelf mode with custom shelf-count and shelf-items', () => {
        const mod = makeModule([
            { id: 'stimuli', type: 'file-upload', value: JSON.stringify([{ s3Key: 'a.jpg' }, { s3Key: 'b.jpg' }]) },
            { id: 'display-mode', value: 'shelf' },
            { id: 'shelf-count', value: '3' },
            { id: 'shelf-items', value: '4' },
            { id: 'randomize-stimuli', type: 'checkbox', value: 'true' },
        ]);
        const config = extractConfig(mod);

        expect(config.displayMode).toBe('shelf');
        expect(config.shelfCount).toBe(3);
        expect(config.shelfItems).toBe(4);
        expect(config.randomizeStimuli).toBe(true);
    });

    it('extracts all stimulus URLs into stimulusUrls array', () => {
        const mod = makeModule([
            {
                id: 'stimuli',
                type: 'file-upload',
                value: JSON.stringify([
                    { s3Key: 'img1.jpg' },
                    { url: 'https://example.com/img2.png' },
                    { s3Key: 'img3.gif' },
                ]),
            },
        ]);
        const config = extractConfig(mod);

        expect(config.stimulusUrls).toEqual(['img1.jpg', 'https://example.com/img2.png', 'img3.gif']);
        expect(config.stimulusUrl).toBe('img1.jpg');
    });

    it('returns empty stimulusUrls when no stimuli component', () => {
        const mod = makeModule([]);
        const config = extractConfig(mod);

        expect(config.stimulusUrls).toEqual([]);
        expect(config.stimulusUrl).toBe('');
    });

    it('handles single string stimulus (legacy format)', () => {
        const mod = makeModule([
            { id: 'stimuli', type: 'file-upload', value: JSON.stringify('legacy-url.jpg') },
        ]);
        const config = extractConfig(mod);

        expect(config.stimulusUrl).toBe('legacy-url.jpg');
        expect(config.stimulusUrls).toEqual(['legacy-url.jpg']);
    });

    it('handles non-JSON raw value as stimulus URL', () => {
        const mod = makeModule([
            { id: 'stimuli', type: 'file-upload', value: 'raw-path.jpg' },
        ]);
        const config = extractConfig(mod);

        expect(config.stimulusUrl).toBe('raw-path.jpg');
        expect(config.stimulusUrls).toEqual(['raw-path.jpg']);
    });

    it('isVideo is false in shelf mode even with video URL', () => {
        const mod = makeModule([
            { id: 'stimuli', type: 'file-upload', value: JSON.stringify([{ s3Key: 'video.mp4' }]) },
            { id: 'display-mode', value: 'shelf' },
        ]);
        const config = extractConfig(mod);

        expect(config.isVideo).toBe(false);
        expect(config.displayMode).toBe('shelf');
    });

    it('isVideo is true in stand_alone mode with video URL', () => {
        const mod = makeModule([
            { id: 'stimuli', type: 'file-upload', value: JSON.stringify([{ s3Key: 'video.mp4' }]) },
        ]);
        const config = extractConfig(mod);

        expect(config.isVideo).toBe(true);
    });

    it('filters out empty URLs from stimulusUrls', () => {
        const mod = makeModule([
            {
                id: 'stimuli',
                type: 'file-upload',
                value: JSON.stringify([{ s3Key: 'a.jpg' }, { s3Key: '' }, { url: '' }, { s3Key: 'b.jpg' }]),
            },
        ]);
        const config = extractConfig(mod);

        expect(config.stimulusUrls).toEqual(['a.jpg', 'b.jpg']);
    });

    it('extracts viewing duration correctly', () => {
        const mod = makeModule([
            { id: 'stimuli', type: 'file-upload', value: JSON.stringify([{ s3Key: 'x.jpg' }]) },
            { id: 'priming-time', value: '30' },
        ]);
        const config = extractConfig(mod);

        expect(config.viewingDuration).toBe(30000);
    });

    it('auto-detects shelf mode when >1 image even without display-mode component', () => {
        const mod = makeModule([
            {
                id: 'stimuli',
                type: 'file-upload',
                value: JSON.stringify([{ s3Key: 'a.jpg' }, { s3Key: 'b.jpg' }, { s3Key: 'c.jpg' }]),
            },
        ]);
        const config = extractConfig(mod);

        expect(config.displayMode).toBe('shelf');
        expect(config.isVideo).toBe(false);
    });

    it('stays stand_alone with exactly 1 image and no display-mode', () => {
        const mod = makeModule([
            { id: 'stimuli', type: 'file-upload', value: JSON.stringify([{ s3Key: 'single.jpg' }]) },
        ]);
        const config = extractConfig(mod);

        expect(config.displayMode).toBe('stand_alone');
    });
});

describe('extractConfig — calibration failure action', () => {
    it('applies no calibration rule to modules created before the setting existed', () => {
        expect(extractConfig(makeModule([])).calibrationFailureAction).toBeNull();
    });

    it('reads disqualify-study from new modules', () => {
        const mod = makeModule([{ id: 'calibration-failure-action', type: 'radio', value: 'disqualify-study' }]);
        expect(extractConfig(mod).calibrationFailureAction).toBe('disqualify-study');
    });

    it('reads skip-module when the researcher chose it', () => {
        const mod = makeModule([{ id: 'calibration-failure-action', type: 'radio', value: 'skip-module' }]);
        expect(extractConfig(mod).calibrationFailureAction).toBe('skip-module');
    });
});

describe('isCalibrationAccurate', () => {
    it('accepts RMSE up to 25% of the viewport width', () => {
        expect(isCalibrationAccurate(250, 1000)).toBe(true);
    });

    it('rejects RMSE above 25% of the viewport width', () => {
        expect(isCalibrationAccurate(251, 1000)).toBe(false);
    });

    it('rejects a calibration without RMSE', () => {
        expect(isCalibrationAccurate(null, 1000)).toBe(false);
    });
});
