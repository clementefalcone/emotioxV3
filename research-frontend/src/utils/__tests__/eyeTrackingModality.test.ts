import { describe, expect, it } from 'vitest';
import { eyeTrackingStageLabel } from '../eyeTrackingModality';

const moduleWith = (components: Array<{ id: string; value: unknown }>) => ({ config: { structure: { components } } });

describe('eyeTrackingStageLabel', () => {
    it('labels a stage with display-mode shelf as Shelf', () => {
        expect(eyeTrackingStageLabel([moduleWith([{ id: 'display-mode', value: 'shelf' }])])).toBe('Shelf');
    });

    it('labels a stage with the legacy shelf checkbox as Shelf', () => {
        expect(eyeTrackingStageLabel([moduleWith([{ id: 'is-shelf-task', value: 'true' }])])).toBe('Shelf');
    });

    it('labels a stand_alone or unconfigured stage as Stand Alone', () => {
        expect(eyeTrackingStageLabel([moduleWith([{ id: 'display-mode', value: 'stand_alone' }])])).toBe('Stand Alone');
        expect(eyeTrackingStageLabel([{ config: {} }])).toBe('Stand Alone');
    });
});
