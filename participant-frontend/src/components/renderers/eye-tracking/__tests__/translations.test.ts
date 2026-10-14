import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import es from '../../../../i18n/locales/es.json';
import en from '../../../../i18n/locales/en.json';

const phaseDir = join(__dirname, '..');
const sourceFiles = [
    join(phaseDir, '..', 'EyeTrackingRenderer.tsx'),
    ...readdirSync(phaseDir).filter(name => name.endsWith('.tsx')).map(name => join(phaseDir, name)),
];

const usedKeys = [...new Set(
    sourceFiles.flatMap(file => [...readFileSync(file, 'utf8').matchAll(/t\('(eyeTracking\.[\w.]+)'/g)].map(match => match[1])),
)];

const lookup = (locale: object, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);

describe('eye tracking translations', () => {
    it('finds the keys used by the participant screens', () => {
        expect(usedKeys).toContain('eyeTracking.qg.title');
        expect(usedKeys).toContain('eyeTracking.lowResolutionWarning');
    });

    it.each([['es', es], ['en', en]])('defines every key in %s', (_, locale) => {
        expect(usedKeys.filter(key => typeof lookup(locale, key) !== 'string')).toEqual([]);
    });
});
