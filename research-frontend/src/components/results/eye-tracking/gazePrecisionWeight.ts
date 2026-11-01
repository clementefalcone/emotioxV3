export interface GazeUncertainty {
    x: number;
    y: number;
}

const HEATMAP_KERNEL_PERCENT = 5;

const axisWeight = (spreadPercent: number): number =>
    Math.sqrt((HEATMAP_KERNEL_PERCENT ** 2) / (HEATMAP_KERNEL_PERCENT ** 2 + spreadPercent ** 2));

export const gazePrecisionWeight = (uncertainty: GazeUncertainty | undefined): number =>
    uncertainty ? axisWeight(uncertainty.x) * axisWeight(uncertainty.y) : 1;
