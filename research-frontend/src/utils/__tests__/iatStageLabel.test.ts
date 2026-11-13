import { describe, expect, it } from 'vitest';
import { iatStageLabel } from '../implicitAssociationBuilder';

describe('iatStageLabel', () => {
    it('names the stage after its single IAT type', () => {
        expect(iatStageLabel([{ name: 'Comparing Attribute' }])).toBe('IAT Comparing Attribute');
        expect(iatStageLabel([{ name: 'object comparing' }, { name: 'Objects Comparing' }])).toBe('IAT Objects Comparing');
    });

    it('falls back to IAT when types are mixed or unknown', () => {
        expect(iatStageLabel([{ name: 'Attribute Testing' }, { name: 'Comparing Attribute' }])).toBe('IAT');
        expect(iatStageLabel([])).toBe('IAT');
    });
});
