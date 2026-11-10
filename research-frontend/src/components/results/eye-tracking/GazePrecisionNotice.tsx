import { Info } from 'lucide-react';
import type { EyeTrackingAOI, EyeTrackingParticipant } from '../../../services/analytics.service';
import { summarizeGazePrecision } from './gazePrecisionSummary';

const joinWithAnd = (items: string[]): string =>
    items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;

const describeNarrowZones = (narrowCount: number, totalCount: number): string => {
    const reading = 'como una tendencia, no como un valor exacto.';
    if (narrowCount === totalCount) {
        return `Todas las zonas (${totalCount}) son más estrechas que esa desviación: lee sus porcentajes ${reading}`;
    }
    if (narrowCount === 1) {
        return `1 de ${totalCount} zonas es más estrecha que esa desviación: lee su porcentaje ${reading}`;
    }
    return `${narrowCount} de ${totalCount} zonas son más estrechas que esa desviación: lee sus porcentajes ${reading}`;
};

export const GazePrecisionNotice = ({ participants, excludedParticipants, aois }: {
    participants: ReadonlyArray<EyeTrackingParticipant>;
    excludedParticipants: ReadonlySet<string>;
    aois: ReadonlyArray<Pick<EyeTrackingAOI, 'label' | 'width'>>;
}) => {
    const { devices, faceDetection, narrowAoiLabels } = summarizeGazePrecision(participants, excludedParticipants, aois);
    if (devices.length === 0 && faceDetection.length === 0) return null;
    return (
        <div className="flex gap-2 px-4 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-600">
            <Info className="h-3.5 w-3.5 mt-px shrink-0 text-slate-400" />
            <div className="space-y-0.5">
                {devices.length > 0 && (
                    <p>
                        {`La mirada registrada puede desviarse hasta ${joinWithAnd(devices.map(device => `un ${device.errorPercent} %${device === devices[0] ? ' del ancho de la pantalla' : ''} en ${device.label.toLowerCase()}`))}.`}
                    </p>
                )}
                {narrowAoiLabels.length > 0 && (
                    <p title={narrowAoiLabels.join(', ')}>{describeNarrowZones(narrowAoiLabels.length, aois.length)}</p>
                )}
                {faceDetection.length > 0 && (
                    <p>
                        {`La cámara detectó el rostro ${joinWithAnd(faceDetection.map(device => `el ${device.percent} %${device === faceDetection[0] ? ' del tiempo' : ''} en ${device.label.toLowerCase()}`))}.`}
                    </p>
                )}
            </div>
        </div>
    );
};
