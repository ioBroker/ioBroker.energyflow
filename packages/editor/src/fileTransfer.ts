/**
 * Saving a file to and picking files from the user's disk, in the browser.
 *
 * Both work without a server round trip: a download is a blob URL on a throw-away link, a pick is a
 * throw-away `<input type="file">`. Neither needs permissions beyond what a click already grants.
 */

/**
 * Offer text as a file download.
 *
 * @param fileName the suggested name
 * @param text the content
 * @param type the MIME type
 */
export function downloadText(fileName: string, text: string, type = 'application/json'): void {
    downloadBlob(fileName, new Blob([text], { type }));
}

/**
 * Offer any content as a file download.
 *
 * @param fileName the suggested name
 * @param blob the content
 */
export function downloadBlob(fileName: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    // Some browsers only honour the click of a link that is part of the document
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick: revoking synchronously can cancel the download before it starts
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface PickedFile {
    name: string;
    text: string;
}

/**
 * Let the user pick files, and read them as text.
 *
 * Resolves with an empty list when the picker is cancelled -- where the browser reports that at all.
 * Older browsers fire nothing on cancel, and then the promise simply never settles, which is harmless:
 * nothing waits for it but the handler that opened the picker.
 *
 * @param options which files, and whether several may be chosen
 * @param options.multiple allow choosing several files at once
 * @param options.accept the `accept` attribute of the input
 * @returns name and text of each picked file
 */
export function pickFiles(options: { multiple?: boolean; accept?: string } = {}): Promise<PickedFile[]> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = options.accept ?? '.json,application/json';
        input.multiple = !!options.multiple;

        input.addEventListener('change', () => {
            const files = [...(input.files ?? [])];
            Promise.all(files.map(async file => ({ name: file.name, text: await file.text() })))
                .then(resolve)
                .catch(reject);
        });
        input.addEventListener('cancel', () => resolve([]));

        input.click();
    });
}
