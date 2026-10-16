export interface NevCluster {
    name: string;
    value: number;
    trend: 'up' | 'down';
}

export interface NevValueBlock {
    nev: number;
    clusters: NevCluster[];
}

const NEV_CLUSTERS = {
    Advocacy: { emotions: ['feliz', 'satisfecho'], isDestroying: false },
    Recommendation: { emotions: ['confiado', 'valorado', 'cuidado', 'enfocado', 'seguro'], isDestroying: false },
    Attention: { emotions: ['interesado', 'energico', 'estimulado', 'exploratorio', 'indulgente'], isDestroying: false },
    Destroying: { emotions: ['irritado', 'apresurado', 'desatendido', 'infeliz', 'descontento', 'estresado', 'decepcion', 'frustrado'], isDestroying: true },
} as const;

type ClusterName = keyof typeof NEV_CLUSTERS;

const LONG_TERM_CLUSTERS: ClusterName[] = ['Advocacy', 'Recommendation', 'Attention', 'Destroying'];
const SHORT_TERM_CLUSTERS: ClusterName[] = ['Attention', 'Destroying'];

const countCluster = (states: Record<string, number>, name: ClusterName): number =>
    NEV_CLUSTERS[name].emotions.reduce((sum, emotion) => sum + (states[emotion] || 0), 0);

const buildBlock = (states: Record<string, number>, names: ClusterName[]): NevValueBlock => {
    const counts = names.map(name => ({ name, count: countCluster(states, name) }));
    const total = counts.reduce((sum, cluster) => sum + cluster.count, 0);
    const destroying = counts.filter(cluster => NEV_CLUSTERS[cluster.name].isDestroying).reduce((sum, cluster) => sum + cluster.count, 0);
    return {
        nev: total > 0 ? Math.round(((total - 2 * destroying) / total) * 100) : 0,
        clusters: counts.map(({ name, count }) => {
            const value = total > 0 ? Math.round((count / total) * 10000) / 100 : 0;
            const isGood = NEV_CLUSTERS[name].isDestroying ? value === 0 : value > 0;
            return { name, value, trend: isGood ? 'up' : 'down' };
        }),
    };
};

export const buildNevValueBlocks = (states: Record<string, number>): { longTerm: NevValueBlock; shortTerm: NevValueBlock } => ({
    longTerm: buildBlock(states, LONG_TERM_CLUSTERS),
    shortTerm: buildBlock(states, SHORT_TERM_CLUSTERS),
});
