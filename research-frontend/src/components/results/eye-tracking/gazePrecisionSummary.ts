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

const medianByDevice = (
    participants: ReadonlyArray<EyeTrackingParticipant>,
    readValue: (participant: EyeTrackingParticipant) => number | null,
) => {
    const valuesByDevice = new Map<string, number[]>();
    for (const participant of participants) {
        const value = readValue(participant);
        if (value === null || !(participant.deviceType in DEVICE_LABELS)) continue;
        valuesByDevice.set(participant.deviceType, [...(valuesByDevice.get(participant.deviceType) ?? []), value]);
    }
    return Array.from(valuesByDevice, ([deviceType, values]) => ({ label: DEVICE_LABELS[deviceType], percent: Math.round(median(values)) }));
};

export const summarizeGazePrecision = (
    participants: ReadonlyArray<EyeTrackingParticipant>,
    excludedParticipants: ReadonlySet<string>,
    aois: ReadonlyArray<Pick<EyeTrackingAOI, 'label' | 'width'>>,
) => {
    const included = participants.filter(p => !excludedParticipants.has(p.participantId));
    const measured = included.filter(p => p.calibrationErrorPercent !== null);
    const devices = medianByDevice(measured, p => p.calibrationErrorPercent).map(({ label, percent }) => ({ label, errorPercent: percent }));
    const faceDetection = medianByDevice(included, p => p.faceDetectedPercent);
    const overallErrorPercent = measured.length > 0 ? median(measured.map(p => p.calibrationErrorPercent as number)) : null;
    const narrowAoiLabels = overallErrorPercent === null ? [] : aois.filter(aoi => aoi.width < overallErrorPercent).map(aoi => aoi.label);
    return { devices, faceDetection, narrowAoiLabels };
};
