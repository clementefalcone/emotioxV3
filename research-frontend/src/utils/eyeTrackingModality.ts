interface ConfigComponent {
    id?: string;
    value?: unknown;
}

const MODALITY_COMPONENT_IDS = new Set(['display-mode', 'modality', 'test-mode']);

const readComponents = (config: Record<string, unknown>): ConfigComponent[] => {
    const structure = (config.structure ?? config) as { components?: ConfigComponent[] };
    return structure.components ?? [];
};

const isShelfConfig = (config: Record<string, unknown>): boolean =>
    readComponents(config).some(component =>
        (MODALITY_COMPONENT_IDS.has(component.id ?? '') && String(component.value ?? '').toLowerCase().includes('shelf'))
        || (component.id === 'is-shelf-task' && String(component.value) === 'true'));

export const eyeTrackingStageLabel = (modules: ReadonlyArray<{ config: Record<string, unknown> }>): string =>
    modules.some(module => isShelfConfig(module.config)) ? 'Shelf' : 'Stand Alone';
