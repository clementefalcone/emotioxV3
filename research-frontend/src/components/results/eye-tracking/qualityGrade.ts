export const QUALITY_GRADES = ['good', 'fair', 'low'] as const;

export type QualityGrade = typeof QUALITY_GRADES[number];

export const QUALITY_GRADE_DISPLAY: Record<QualityGrade, { label: string; textClass: string; badgeClass: string }> = {
  good: { label: 'alta', textClass: 'text-blue-700', badgeClass: 'text-blue-700 bg-blue-100' },
  fair: { label: 'media', textClass: 'text-blue-500', badgeClass: 'text-blue-600 bg-blue-50' },
  low: { label: 'básica', textClass: 'text-slate-500', badgeClass: 'text-slate-600 bg-slate-100' },
};
