import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '../ui/Input';
import { researchService } from '../../services/research.service';
import { researchKeys, useResearch } from '../../hooks/useResearchQuery';
import { useToast } from '../../hooks/useToast';

interface PrivacyContact {
    controllerName: string;
    contactEmail: string;
    policyUrl: string;
}

const PRIVACY_FIELDS: Array<{ key: keyof PrivacyContact; label: string; placeholder: string; type: string }> = [
    { key: 'controllerName', label: 'Responsable de los datos', placeholder: 'Ej: Empresa Cliente SpA', type: 'text' },
    { key: 'contactEmail', label: 'Email para consultas de privacidad', placeholder: 'privacidad@empresa.cl', type: 'email' },
    { key: 'policyUrl', label: 'Link a la política de privacidad', placeholder: 'https://empresa.cl/privacidad', type: 'url' },
];

const readPrivacyContact = (value: unknown): PrivacyContact => {
    const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const read = (key: keyof PrivacyContact) => (typeof record[key] === 'string' ? (record[key] as string) : '');
    return { controllerName: read('controllerName'), contactEmail: read('contactEmail'), policyUrl: read('policyUrl') };
};

export const PrivacyContactSection = ({ researchId }: { researchId: string }) => {
    const queryClient = useQueryClient();
    const toast = useToast();
    const { data: research } = useResearch(researchId);
    const privacy = readPrivacyContact(research?.settings?.privacy);
    const isComplete = PRIVACY_FIELDS.every(({ key }) => privacy[key].trim() !== '');

    const savePrivacy = useMutation({
        mutationFn: (next: PrivacyContact) =>
            researchService.update(researchId, { settings: { ...(research?.settings ?? {}), privacy: next } }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: researchKeys.detail(researchId) }),
        onError: (err: unknown) => toast.error(`No se pudieron guardar los datos de privacidad: ${err instanceof Error ? err.message : String(err)}`),
    });

    const handleBlur = (key: keyof PrivacyContact, value: string) => {
        if (value.trim() === privacy[key]) return;
        savePrivacy.mutate({ ...privacy, [key]: value.trim() });
    };

    return (
        <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-900">Privacidad</h3>
            <p className="text-xs text-gray-500">
                Se muestran en el consentimiento de Eye Tracking, Emotion Analysis y Website Tracking.
            </p>
            {!isComplete && (
                <p className="text-xs text-amber-700">
                    Completa los tres campos: la ley exige informar quién es responsable de los datos y cómo contactarlo.
                </p>
            )}
            {PRIVACY_FIELDS.map(({ key, label, placeholder, type }) => (
                <Input
                    key={`${key}-${privacy[key]}`}
                    label={label}
                    type={type}
                    placeholder={placeholder}
                    defaultValue={privacy[key]}
                    onBlur={(event) => handleBlur(key, event.target.value)}
                />
            ))}
        </div>
    );
};
