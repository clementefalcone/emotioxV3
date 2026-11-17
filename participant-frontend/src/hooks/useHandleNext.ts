import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Module } from '../services/public.service';
import { publicService } from '../services/public.service';
import { resolveScreenerChoiceOptions } from '../utils/screenerParticipant';
import { useSessionStore } from '../stores/useSessionStore';
import { useParticipantStore } from '../stores/useParticipantStore';
import { responseService } from '../services/response.service';
import { mediaService } from '../services/media.service';
import { queryClient } from '../providers/queryClient';

// Turnstile temporarily disabled - will be re-enabled when TURNSTILE_SECRET_KEY is configured
const TURNSTILE_ENABLED = false;

interface UseHandleNextParams {
  isPreviewMode: boolean;
  participantId: string | null;
  researchId: string | undefined;
  currentModule: Module | undefined;
  currentStep: string;
  showRestartOption: boolean;
  backlinks: Record<string, string>;
  goNext: () => { success: boolean; errors?: Array<{ message: string }> };
  startNewSession: () => void;
  clearAllResponses: () => void;
  getResponsesByModule: (moduleId: string) => Array<{
    componentId: string;
    value: unknown;
    metadata?: Record<string, unknown>;
  }>;
  setSubmitting: (value: boolean) => void;
  setShowRestartOption: (value: boolean) => void;
  setMobileRestriction: (value: string | null) => void;
  redirectTo: (url: string) => void;
  disqualifyParticipant: () => void;
}

export const useHandleNext = ({
  isPreviewMode,
  participantId,
  researchId,
  currentModule,
  currentStep,
  showRestartOption,
  backlinks,
  goNext,
  startNewSession,
  clearAllResponses,
  getResponsesByModule,
  setSubmitting,
  setShowRestartOption,
  setMobileRestriction,
  redirectTo,
  disqualifyParticipant,
}: UseHandleNextParams) => {
  const { t } = useTranslation();

  const handleNext = useCallback(async () => {
    // Handle restart option for multiple sessions
    if (showRestartOption && currentStep === 'thank-you') {
      // Start a new session
      startNewSession();
      clearAllResponses();
      mediaService.clearCache();
      queryClient.clear();
      // Clear Turnstile token to force re-verification
      useSessionStore.getState().clearTurnstileToken();
      // If Turnstile is disabled, auto-verify immediately
      if (!TURNSTILE_ENABLED) {
        useSessionStore.getState().setTurnstileToken('disabled');
      }
      // Reset to first step
      useParticipantStore.getState().setCurrentStep('welcome');
      setShowRestartOption(false);
      return;
    }

    // Screener real-time disqualification: check if selected choice has eligibility = 'Disqualify'
    if (currentStep === 'screener' && currentModule) {
      const screenerResponses = useParticipantStore.getState().responses;
      let choiceValue: string | undefined;
      for (const r of screenerResponses.values()) {
        if (r.moduleId === 'screener' && r.componentId === 'choice' && typeof r.value === 'string') {
          choiceValue = r.value;
          break;
        }
      }
      if (choiceValue) {
        const components = currentModule.structure?.components ?? [];
        const choices = resolveScreenerChoiceOptions(components);
        const selected = choices.find(c => c.id === choiceValue);
        if (selected?.eligibility === 'Disqualify') {
          disqualifyParticipant();
          return;
        }
      }
    }

    // Demographics server-side validation (quota & disqualification)
    // Only skip for explicit preview (?preview=true). Participants without ?participantId
    // were incorrectly treated as preview, skipping demographic persistence.
    const isExplicitPreview = new URLSearchParams(window.location.search).get('preview') === 'true';
    if (currentStep === 'demographics' && !isExplicitPreview) {
      const demoResponses = useParticipantStore.getState().responses;
      const demoAnswers: Record<string, string> = {};
      demoResponses.forEach((r) => {
        if (r.moduleId === 'demographics' && typeof r.value === 'string') {
          demoAnswers[r.componentId] = r.value;
        }
      });

      // Check that ALL enabled demographics (predefined + custom screening questions) have been answered
      const demoConfig = currentModule?.config?.demographics as Record<string, unknown> | undefined;
      const enabledDemoKeys = demoConfig
        ? Object.keys(demoConfig).filter(k => {
            const v = demoConfig[k];
            if (v === true) return true;
            if (typeof v === 'object' && v !== null && (v as Record<string, unknown>).enabled === true) return true;
            return false;
          })
        : [];
      const missingKeys = enabledDemoKeys.filter(k => !demoAnswers[k]);
      if (missingKeys.length > 0) {
        alert(t('errors.answerAllDemographics', 'Please answer all demographic questions before continuing.'));
        return;
      }

      try {
        setSubmitting(true);
        const match = window.location.pathname.match(/\/research\/([^/]+)/);
        const rid = match?.[1] ?? researchId;
        if (rid) {
          // Use participantId from URL/hook, or from store (kiosk), or generate a temporary one
          const effectivePid = participantId
            ?? useParticipantStore.getState().participantId
            ?? `anon-${Date.now()}`;

          const result = await publicService.validateDemographics(rid, demoAnswers, effectivePid);
          if (!result.valid) {
            console.warn('[Demographics] Validation failed:', {
              reason: result.reason,
              details: result.details,
              answers: demoAnswers,
            });
            const bl = backlinks;
            if (result.reason === 'RESEARCH_CLOSED') {
              setMobileRestriction(t('errors.researchClosed', 'This survey is no longer accepting responses.'));
              return;
            }
            if (result.reason === 'QUOTA_FULL') {
              if (bl.overquota) { redirectTo(bl.overquota); return; }
              setMobileRestriction(t('errors.quotaFull', 'This survey has reached its participant limit for your profile.'));
              return;
            } else {
              disqualifyParticipant();
              return;
            }
          }
        }
      } catch {
        alert(t('errors.validationError'));
        setSubmitting(false);
        return;
      } finally {
        setSubmitting(false);
      }
    }

    // Verify Turnstile token on welcome step (only in participant mode)
    // Note: TURNSTILE_ENABLED is defined at module level
    if (TURNSTILE_ENABLED && currentStep === 'welcome' && !isPreviewMode) {
      const { turnstileVerified, turnstileToken } = useSessionStore.getState();
      if (!turnstileVerified || !turnstileToken) {
        alert(t('errors.completeSecurityVerification'));
        return;
      }
    }

    // In preview mode, don't send data to backend
    if (isPreviewMode) {
      const result = goNext();
      if (!result.success && result.errors) {
        const errorMessage = result.errors.map(e => e.message).join('\n');
        alert(errorMessage);
      }

      // Check if we've reached the thank-you page and multiple sessions are allowed
      if (result.success && currentStep === 'thank-you') {
        const linkConfig = useSessionStore.getState().config?.linkConfig;
        if (linkConfig?.allowMultiple === true) {
          setShowRestartOption(true);
        }
      }

      return;
    }

    // In participant mode, send data to backend
    if (participantId && researchId && currentModule) {
      // Verify Turnstile token before submitting (required for anti-bot protection)
      // Note: TURNSTILE_ENABLED is defined at module level
      // Skip verification in development (localhost) or if using test site key
      const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const { turnstileToken, turnstileVerified, turnstileTokenUsed } = useSessionStore.getState();
      const { turnstileVerifiedAt } = useParticipantStore.getState();

      // Check if participant was already verified (persisted from previous session)
      const wasAlreadyVerified = turnstileVerifiedAt !== null;

      // Only require token verification if Turnstile is enabled and not already verified
      if (TURNSTILE_ENABLED && !isDevelopment && !turnstileTokenUsed && !wasAlreadyVerified && (!turnstileVerified || !turnstileToken)) {
        alert(t('errors.securityRequired'));
        return;
      }

      // Only send token if Turnstile is enabled and it hasn't been used yet
      // After first use or if previously verified, send null to indicate already verified
      const finalToken = TURNSTILE_ENABLED
        ? ((turnstileTokenUsed || wasAlreadyVerified)
          ? null
          : (isDevelopment && (!turnstileToken || !turnstileVerified)
            ? 'dev-mock-token'
            : turnstileToken))
        : null; // Don't send token when Turnstile is disabled

      // Get all responses for current module
      const moduleResponses = getResponsesByModule(currentModule.id).map((response) => ({
        moduleId: currentModule.id,
        componentId: response.componentId,
        value: response.value,
        metadata: {
          timestamp: (response.metadata?.timestamp as number | undefined) || Date.now(),
          ...response.metadata,
        },
      }));

      // Only submit if there are responses to send
      if (moduleResponses.length > 0) {
        console.log('[handleNext] Submitting responses to backend...');
        try {
          setSubmitting(true);

          await responseService.submitModuleResponses(researchId, participantId, {
            participantId,
            moduleId: currentModule.id,
            responses: moduleResponses,
            metadata: {
              completedAt: Date.now(),
              turnstileToken: finalToken,
              isPreviewMode: false,
            },
          });

          // Mark token as used after first successful submission
          // Turnstile tokens are single-use, so we don't send it again
          if (!turnstileTokenUsed && finalToken) {
            useSessionStore.getState().markTurnstileTokenUsed();
            // Also persist verification in participant store for future sessions
            useParticipantStore.getState().setTurnstileVerified();
          }
        } catch (error: unknown) {
          console.error('Error submitting responses:', error);

          const errorMessage = error instanceof Error ? error.message : t('errors.unknownError');

          // Check if research is no longer active or participant limit reached
          if (errorMessage.includes('not active') || errorMessage.includes('not found') || errorMessage.includes('Participant limit')) {
            setMobileRestriction(t('errors.researchClosed', 'This survey is no longer accepting responses.'));
            return;
          }

          // Check if error is related to Turnstile verification
          if (errorMessage.includes('verification') || errorMessage.includes('Anti-bot') || errorMessage.includes('security')) {
            alert(t('errors.securityVerificationError'));
            // Clear token to force re-verification
            useSessionStore.getState().clearTurnstileToken();
          } else {
            alert(t('errors.saveResponsesError'));
          }

          setSubmitting(false);
          return;
        } finally {
          setSubmitting(false);
        }
      }
    }

    // Navigate to next step
    // Redirect/restart on thank-you is handled by the useEffect above (reacts to currentStep change)
    const result = goNext();
    if (!result.success && result.errors) {
      const errorMessage = result.errors.map(e => e.message).join('\n');
      alert(errorMessage);
    }
  }, [isPreviewMode, participantId, researchId, currentModule, getResponsesByModule, goNext, showRestartOption, startNewSession, clearAllResponses, currentStep, backlinks, t, redirectTo, setSubmitting, setShowRestartOption, setMobileRestriction, disqualifyParticipant]);

  return handleNext;
};
