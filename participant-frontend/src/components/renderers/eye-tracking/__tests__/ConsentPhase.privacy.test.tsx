import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from '../../../../i18n/locales/es.json';
import type { PrivacyNotice } from '../../../../services/public.service';

const store = vi.hoisted(() => ({ privacyNotice: null as PrivacyNotice | null }));
vi.mock('../../../../stores/useParticipantStore', () => ({
    useParticipantStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

import { ConsentPhase } from '../ConsentPhase';

void i18n.use(initReactI18next).init({ resources: { es: { translation: es } }, lng: 'es', interpolation: { escapeValue: false } });

const renderConsent = (onAccept = vi.fn().mockResolvedValue(true)) => {
    render(<ConsentPhase taskDescription="" hasEmotionRecognition isGazeModelLoaded onAccept={onAccept} onDecline={vi.fn()} />);
    return onAccept;
};

describe('ConsentPhase privacy disclosure', () => {
    it('shows purpose, sensitivity, retention, controller, rights and policy, and records them as the consent text', async () => {
        store.privacyNotice = { controllerName: 'Acme SpA', contactEmail: 'privacidad@acme.cl', policyUrl: 'https://acme.cl/privacidad', biometricRetentionMonths: 6 };
        const onAccept = renderConsent();

        expect(screen.getByRole('link', { name: 'Política de privacidad' }).getAttribute('href')).toBe('https://acme.cl/privacidad');
        const acceptButton = screen.getByRole('button', { name: 'Acepto y activo la cámara' }) as HTMLButtonElement;
        expect(acceptButton.disabled).toBe(true);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Confirmo que tengo 18 años o más.' }));
        expect(acceptButton.disabled).toBe(false);
        await act(async () => { fireEvent.click(acceptButton); });

        const recordedText = onAccept.mock.calls[0][0] as string;
        expect(recordedText).toContain('Finalidad: investigación de experiencia de usuario.');
        expect(recordedText).toContain('datos biométricos, considerados sensibles');
        expect(recordedText).toContain('Los datos se guardan 6 meses y luego se borran.');
        expect(recordedText).toContain('Responsable: Acme SpA · privacidad@acme.cl');
        expect(recordedText).toContain('Puedes pedir acceso o borrado de tus datos');
        expect(recordedText).toContain('Confirmo que tengo 18 años o más.');
    });

    it('still explains purpose and rights when the study has no controller or policy configured', () => {
        store.privacyNotice = { controllerName: '', contactEmail: '', policyUrl: '', biometricRetentionMonths: 12 };
        renderConsent();

        expect(screen.getByText('Finalidad: investigación de experiencia de usuario.').tagName).toBe('P');
        expect(screen.getByText('Los datos se guardan 12 meses y luego se borran.').tagName).toBe('P');
        expect(screen.queryByText(/Responsable:/)).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });
});
