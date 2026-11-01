import type { EyeTrackingAOI, EyeTrackingParticipant } from '../../../services/analytics.service';

const DEVICE_LABELS: Record<string, string> = {
    desktop: 'Escritorio',
    mobile: 'Móvil',
    tablet: 'Tablet',
};

const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

export const summarizeGazePrecision = (
    participants: ReadonlyArray<EyeTrackingParticipant>,
    excludedParticipants: ReadonlySet<string>,
    aois: ReadonlyArray<Pick<EyeTrackingAOI, 'label' | 'width'>>,
) => {
    const measured = participants.filter(p => !excludedParticipants.has(p.participantId) && p.calibrationErrorPercent !== null);
    const errorsByDevice = new Map<string, number[]>();
    for (const participant of measured) {
        if (!(participant.deviceType in DEVICE_LABELS)) continue;
        errorsByDevice.set(participant.deviceType, [...(errorsByDevice.get(participant.deviceType) ?? []), participant.calibrationErrorPercent as number]);
    }
    const devices = Array.from(errorsByDevice, ([deviceType, errors]) => ({ label: DEVICE_LABELS[deviceType], errorPercent: Math.round(median(errors)) }));
    const overallErrorPercent = measured.length > 0 ? median(measured.map(p => p.calibrationErrorPercent as number)) : null;
    const narrowAoiLabels = overallErrorPercent === null ? [] : aois.filter(aoi => aoi.width < overallErrorPercent).map(aoi => aoi.label);
    return { devices, narrowAoiLabels };
};
