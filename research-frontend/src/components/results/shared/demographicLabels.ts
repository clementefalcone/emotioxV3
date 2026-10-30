const DEMOGRAPHIC_LABELS: Record<string, string> = {
    age: 'Age range',
    country: 'Country',
    gender: 'Gender',
    educationLevel: 'Education level',
    annualIncome: 'Annual Income',
    employmentStatus: 'Employment Status',
    dailyHoursOnline: 'Daily Hours Online',
    technicalProficiency: 'Technical Proficiency',
};

export function getDemographicLabel(key: string): string {
    return DEMOGRAPHIC_LABELS[key] ?? key;
}
