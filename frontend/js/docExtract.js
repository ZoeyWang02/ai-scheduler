// Reads the text out of a document in the browser, so only plain text is sent to the server.
// (Parsing PDFs/DOCX on the server would be slow, and a free-plan Worker has ~10 ms of CPU per request.)
//
//   .txt / .md  -> the file's text
//   .docx       -> a small zip reader + XML text pull (no library)
//   .pdf        -> pdf.js, loaded from a CDN only when a PDF is actually imported

export const DOCUMENT_EXTENSIONS = ['pdf', 'docx', 'txt', 'md'];

// Only the text is uploaded, so the file itself may be larger than the server's 2 MB file limit.
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

// Keep in step with the server (MAX_TEXT_CHARS): anything longer is cut here.
const MAX_TEXT_CHARS = 380000;

const PDFJS_VERSION = '4.4.168';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

export function fileExtension(name) {
    const match = /\.([A-Za-z0-9]+)$/.exec(name || '');
    return match ? match[1].toLowerCase() : '';
}

export const isDocumentFile = (file) => DOCUMENT_EXTENSIONS.includes(fileExtension(file.name));

/** A user-facing Error: `code` tells the caller which translated message to show. */
export class DocumentError extends Error {
    constructor(code, message) {
        super(message || code);
        this.code = code;
    }
}

/** Plain text of the document. Throws DocumentError (code: tooLarge | unsupported | unreadable | empty). */
export async function extractDocumentText(file) {
    if (file.size > MAX_DOCUMENT_BYTES) throw new DocumentError('tooLarge');
    const ext = fileExtension(file.name);
    let text;
    try {
        if (ext === 'txt' || ext === 'md') text = await file.text();
        else if (ext === 'docx') text = await docxToText(await file.arrayBuffer());
        else if (ext === 'pdf') text = await pdfToText(await file.arrayBuffer());
        else throw new DocumentError('unsupported');
    } catch (error) {
        if (error instanceof DocumentError) throw error;
        throw new DocumentError('unreadable', error && error.message);
    }
    text = normalizeText(text);
    if (text.length < 20) throw new DocumentError('empty');
    return text.slice(0, MAX_TEXT_CHARS);
}

function normalizeText(text) {
    return String(text).replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---- DOCX ----------------------------------------------------------------------------------------

/** The readable text of a .docx (paragraphs on their own lines, table cells separated by " | "). */
export async function docxToText(buffer) {
    const xml = await readZipEntry(buffer, 'word/document.xml');
    if (xml === null) throw new DocumentError('unreadable', 'word/document.xml not found');
    return wordXmlToText(new TextDecoder('utf-8').decode(xml));
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
});

export function wordXmlToText(xml) {
    let out = '';
    let inCell = 0; // every table cell holds a paragraph; keep a row on one line instead of one line per cell
    const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:tc(?:\s[^>]*)?>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
    for (let m; (m = token.exec(xml));) {
        if (m[1] !== undefined) out += decodeEntities(m[1]);
        else if (m[0] === '<w:tab/>') out += '\t';
        else if (m[0] === '<w:br/>') out += inCell ? ' ' : '\n';
        else if (m[0].startsWith('<w:tc')) inCell++;
        else if (m[0] === '</w:p>') out += inCell ? ' ' : '\n';
        else if (m[0] === '</w:tc>') { inCell = Math.max(0, inCell - 1); out += ' | '; }
        else if (m[0] === '</w:tr>') out += '\n';
    }
    return out.replace(/ +\| /g, ' | ').replace(/ \| \n/g, '\n');
}

/** One file out of a zip, as bytes (null when it is not in the archive). Handles stored and deflated entries. */
export async function readZipEntry(buffer, wanted) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 22 - 65535); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new DocumentError('unreadable', 'not a zip file');

    const entries = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    for (let n = 0; n < entries; n++) {
        if (view.getUint32(p, true) !== 0x02014b50) break;
        const method = view.getUint16(p + 10, true);
        const compressedSize = view.getUint32(p + 20, true);
        const nameLength = view.getUint16(p + 28, true);
        const extraLength = view.getUint16(p + 30, true);
        const commentLength = view.getUint16(p + 32, true);
        const localHeader = view.getUint32(p + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
        if (name === wanted) {
            if (view.getUint32(localHeader, true) !== 0x04034b50) throw new DocumentError('unreadable', 'bad zip entry');
            const dataStart = localHeader + 30 + view.getUint16(localHeader + 26, true) + view.getUint16(localHeader + 28, true);
            const data = bytes.subarray(dataStart, dataStart + compressedSize);
            if (method === 0) return data;
            if (method === 8) return inflateRaw(data);
            throw new DocumentError('unreadable', `unsupported zip method ${method}`);
        }
        p += 46 + nameLength + extraLength + commentLength;
    }
    return null;
}

async function inflateRaw(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---- PDF -----------------------------------------------------------------------------------------

let pdfjsPromise = null;

function loadPdfJs() {
    if (!pdfjsPromise) {
        pdfjsPromise = (async () => {
            const pdfjs = await import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.min.mjs`);
            // A cross-origin Worker cannot be created directly; wrap the CDN script in a same-origin blob.
            const source = await (await fetch(`${PDFJS_BASE}/pdf.worker.min.mjs`)).text();
            pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            return pdfjs;
        })().catch((error) => { pdfjsPromise = null; throw error; });
    }
    return pdfjsPromise;
}

async function pdfToText(buffer) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    try {
        const pages = Math.min(doc.numPages, 60); // a syllabus is a few pages; stop long books early
        let out = '';
        for (let i = 1; i <= pages; i++) {
            const content = await (await doc.getPage(i)).getTextContent();
            for (const item of content.items) {
                out += item.str;
                out += item.hasEOL ? '\n' : ' ';
            }
            out += '\n\n';
            if (out.length > MAX_TEXT_CHARS) break;
        }
        return out;
    } finally {
        doc.destroy();
    }
}
