import { describe, it, expect } from 'vitest';
import { buildNevValueBlocks } from '../nevValueBlocks';

describe('buildNevValueBlocks', () => {
    const states = { feliz: 2, confiado: 1, interesado: 3, frustrado: 2, estresado: 2 };

    it('long term uses all four clusters and every emotion', () => {
        const { longTerm } = buildNevValueBlocks(states);
        expect(longTerm.clusters.map(cluster => [cluster.name, cluster.value])).toEqual([
            ['Advocacy', 20], ['Recommendation', 10], ['Attention', 30], ['Destroying', 40],
        ]);
        expect(longTerm.nev).toBe(20);
    });

    it('short term only weighs attention against destroying', () => {
        const { shortTerm } = buildNevValueBlocks(states);
        expect(shortTerm.clusters.map(cluster => [cluster.name, cluster.value])).toEqual([
            ['Attention', 42.86], ['Destroying', 57.14],
        ]);
        expect(shortTerm.nev).toBe(-14);
    });

    it('places each pyramid emotion in its cluster', () => {
        const { longTerm } = buildNevValueBlocks({ satisfecho: 1, cuidado: 1, enfocado: 1, seguro: 1, indulgente: 1, desatendido: 1, descontento: 1, apresurado: 1 });
        expect(longTerm.clusters.map(cluster => [cluster.name, cluster.value])).toEqual([
            ['Advocacy', 12.5], ['Recommendation', 37.5], ['Attention', 12.5], ['Destroying', 37.5],
        ]);
    });

    it('marks destroying as down only when someone felt it', () => {
        expect(buildNevValueBlocks(states).shortTerm.clusters[1].trend).toBe('down');
        expect(buildNevValueBlocks({ interesado: 1 }).shortTerm.clusters.map(cluster => cluster.trend)).toEqual(['up', 'up']);
    });

    it('returns zero NEV and shares when nobody answered', () => {
        const { longTerm, shortTerm } = buildNevValueBlocks({});
        expect(longTerm.nev).toBe(0);
        expect(shortTerm.nev).toBe(0);
        expect(shortTerm.clusters.every(cluster => cluster.value === 0)).toBe(true);
    });
});
