import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { publicService, type ConsentRecord } from '../services/public.service';
import { useParticipantStore } from '../stores/useParticipantStore';
import { usePreviewMode } from './usePreviewMode';

export const useConsentRecorder = (context: ConsentRecord['context']) => {
  const { researchId } = useParams<{ researchId: string }>();
  const { isPreviewMode } = usePreviewMode();
  const participantId = useParticipantStore((state) => state.participantId);
  const { i18n } = useTranslation();

  return useCallback(async (decision: ConsentRecord['decision'], text: string): Promise<void> => {
    if (isPreviewMode) return;
    if (!researchId || !participantId) {
      throw new Error(`Cannot record ${decision} consent for ${context}: research ${researchId ?? 'missing'}, participant ${participantId ?? 'missing'}`);
    }
    await publicService.recordConsent(researchId, { subjectId: participantId, context, decision, text, locale: i18n.language });
  }, [context, i18n.language, isPreviewMode, participantId, researchId]);
};
