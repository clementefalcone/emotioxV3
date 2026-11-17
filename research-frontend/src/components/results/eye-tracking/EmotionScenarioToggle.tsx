import type { EmotionScenario } from './emotionScenario';

const SCENARIO_OPTIONS: readonly { value: EmotionScenario; label: string }[] = [
  { value: 'ux', label: 'UX/UI' },
  { value: 'fmcg', label: 'FMCG' },
];

export const EmotionScenarioToggle = ({ scenario, onChange }: { scenario: EmotionScenario; onChange: (scenario: EmotionScenario) => void }) => (
  <div role="group" aria-label="Nombres de emociones" className="ml-auto flex rounded-full border border-gray-200 p-0.5 text-xs">
    {SCENARIO_OPTIONS.map(option => (
      <button
        key={option.value}
        type="button"
        aria-pressed={scenario === option.value}
        onClick={() => onChange(option.value)}
        className={`rounded-full px-3 py-1 font-medium transition-colors ${scenario === option.value ? 'bg-[#006AFF] text-white' : 'text-slate-500 hover:text-slate-700'}`}
      >
        {option.label}
      </button>
    ))}
  </div>
);
