/**
 * The diagram as a picture: for a forum post, a wiki, a message to somebody who is not on the system.
 *
 * It is the rendered SVG of the designer, minus what only the designer shows -- grid, handles,
 * selection frame (the renderer marks those with classes for exactly this). A PNG is that SVG drawn
 * onto a canvas at twice the size.
 */
import { downloadBlob } from './fileTransfer';

/**
 * The diagram as standalone SVG markup.
 *
 * @param svg the rendered diagram
 * @param background fill behind it; a transparent diagram on a dark page is invisible anywhere else
 * @returns the markup and its size in canvas units
 */
export function diagramSvg(svg: SVGSVGElement, background?: string): { markup: string; width: number; height: number } {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('.ef-overlay, .ef-background, .ef-selection').forEach(element => element.remove());

    const [, , width, height] = (svg.getAttribute('viewBox') || '0 0 900 560').split(/\s+/).map(Number);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', `${width}`);
    clone.setAttribute('height', `${height}`);
    clone.removeAttribute('tabindex');
    // The page's font, written out: a file on its own would otherwise fall back to a serif
    clone.style.fontFamily = getComputedStyle(svg).fontFamily;
    clone.style.touchAction = '';
    clone.style.outline = '';

    if (background) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', `${width}`);
        rect.setAttribute('height', `${height}`);
        rect.setAttribute('fill', background);
        // After the <style>, before everything that is drawn
        const style = clone.querySelector('style');
        clone.insertBefore(rect, style ? style.nextSibling : clone.firstChild);
    }

    return { markup: new XMLSerializer().serializeToString(clone), width, height };
}

/**
 * Save the diagram as an SVG file.
 *
 * @param svg the rendered diagram
 * @param fileName without extension
 * @param background fill behind it
 */
export function exportSvg(svg: SVGSVGElement, fileName: string, background?: string): void {
    const { markup } = diagramSvg(svg, background);
    downloadBlob(`${fileName}.svg`, new Blob([markup], { type: 'image/svg+xml' }));
}

/**
 * Save the diagram as a PNG file, at twice its canvas size so it stays sharp on a phone.
 *
 * @param svg the rendered diagram
 * @param fileName without extension
 * @param background fill behind it
 * @returns resolves once the download has been offered
 */
export async function exportPng(svg: SVGSVGElement, fileName: string, background?: string): Promise<void> {
    const { markup, width, height } = diagramSvg(svg, background);
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await image.decode();

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('No canvas');
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
        // An icon from another server taints the canvas; the SVG export has no such limit
        throw new Error('The picture could not be created');
    }
    downloadBlob(`${fileName}.png`, blob);
}
