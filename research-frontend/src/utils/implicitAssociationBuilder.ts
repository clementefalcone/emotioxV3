import type { ComponentConfig } from '../types/moduleBuilder.types';

const IAT_MODULE_NAMES = new Set([
    'attribute testing',
    'comparing attribute',
    'objects comparing',
    'object comparing',
]);

const IAT_TYPE_TITLES: Record<string, string> = {
    'attribute testing': 'Attribute Testing',
    'comparing attribute': 'Comparing Attribute',
    'objects comparing': 'Objects Comparing',
    'object comparing': 'Objects Comparing',
};

export function iatStageLabel(modules: ReadonlyArray<{ name: string }>): string {
    const titles = new Set(modules.flatMap(module => IAT_TYPE_TITLES[module.name.trim().toLowerCase()] ?? []));
    return titles.size === 1 ? `IAT ${[...titles][0]}` : 'IAT';
}

/**
 * @param moduleName - Active module name (template name, e.g. Attribute Testing)
 * @returns True if this module belongs to Implicit Association IAT templates
 */
export function isImplicitAssociationModuleName(moduleName: string | undefined): boolean {
    if (!moduleName?.trim()) {
        return false;
    }
    return IAT_MODULE_NAMES.has(moduleName.trim().toLowerCase());
}

/**
 * Parses Target N / Object N index from groupLabel (Implicit Association templates).
 * @param groupLabel - settings.groupLabel from component config
 * @returns 1-based index or null if not an IAT target group
 */
export function parseIatTargetGroupIndex(groupLabel: string | undefined): number | null {
    if (!groupLabel?.trim()) {
        return null;
    }
    const m = groupLabel.trim().match(/^(?:Target|Object)\s+(\d+)$/i);
    if (!m) {
        return null;
    }
    return parseInt(m[1], 10);
}

export interface IatTargetColumn {
    index: number;
    components: ComponentConfig[];
}

/**
 * Splits visible components into IAT target/object columns (by Target N / Object N) and the rest (priming, criteria, etc.).
 * @param components - Visible module components sorted by order
 * @returns Columns sorted by index, and remaining components in original order
 */
export function partitionImplicitAssociationTargets(components: ComponentConfig[]): {
    columns: IatTargetColumn[];
    rest: ComponentConfig[];
} {
    const sorted = [...components].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const buckets = new Map<number, ComponentConfig[]>();
    const rest: ComponentConfig[] = [];
    for (const c of sorted) {
        const idx = parseIatTargetGroupIndex(
            typeof c.settings?.groupLabel === 'string' ? c.settings.groupLabel : undefined
        );
        if (idx !== null) {
            if (!buckets.has(idx)) {
                buckets.set(idx, []);
            }
            buckets.get(idx)!.push(c);
        } else {
            rest.push(c);
        }
    }
    const columns: IatTargetColumn[] = [...buckets.keys()]
        .sort((a, b) => a - b)
        .map((index) => ({
            index,
            components: buckets.get(index) ?? [],
        }));
    return { columns, rest };
}
