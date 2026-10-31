/**
 * Triggers a CSV file download in the browser.
 * @param csv - CSV content string
 * @param filename - Download filename (e.g. "linear-scale-3.5.csv")
 */
export function triggerCsvDownload(csv: string, filename: string, mimeType = 'text/csv;charset=utf-8;'): void {
    const blob = new Blob([csv], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
}

export function buildCsv<Row extends object>(rows: ReadonlyArray<Row>, columns: ReadonlyArray<keyof Row & string>): string {
    const escapeCell = (value: unknown): string => {
        if (value == null) return '';
        const text = String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const body = rows.map(row => columns.map(column => escapeCell(row[column])).join(','));
    return [columns.join(','), ...body].join('\n');
}
