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
