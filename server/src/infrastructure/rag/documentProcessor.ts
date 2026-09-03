import { logger } from "../../config/pino.js";

export type DocumentInput = {
    title: string;
    mimeType?: string | null;
    sourceUrl?: string | null;
    rawContent?: string | null;
    fileBuffer?: Buffer | null; // pdf/etc
};

export type ProcessedDocument = {
    text: string;
    metadata: Record<string, unknown>;
};

export async function extractText(input: DocumentInput): Promise<ProcessedDocument> {
    const mime = (input.mimeType ?? "").toLowerCase();

    // URL fetch if sourceUrl provided and no rawContent
    if (input.sourceUrl && !input.rawContent && !input.fileBuffer) {
        try {
            const res = await fetch(input.sourceUrl, { headers: { "User-Agent": "CharacterVerse/1.0" } });
            if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
            const ct = res.headers.get("content-type") ?? "";
            if (ct.includes("pdf") || input.sourceUrl.endsWith(".pdf")) {
                const buf = Buffer.from(await res.arrayBuffer());
                return await extractFromPdf(buf);
            }
            const text = await res.text();
            // naive html strip if needed
            const stripped = ct.includes("html") ? stripHtml(text) : text;
            return { text: normalizeText(stripped), metadata: { sourceUrl: input.sourceUrl, contentType: ct } };
        } catch (err) {
            logger.warn({ err, sourceUrl: input.sourceUrl }, "URL extraction failed");
            throw new Error(`Failed to fetch URL: ${String(err)}`);
        }
    }

    if (input.fileBuffer) {
        if (mime.includes("pdf") || isPdfBuffer(input.fileBuffer)) {
            return await extractFromPdf(input.fileBuffer);
        }
        // text/markdown files
        return { text: normalizeText(input.fileBuffer.toString("utf-8")), metadata: { mimeType: mime } };
    }

    if (input.rawContent) {
        if (mime.includes("pdf")) {
            // rawContent is base64?
            try {
                const buf = Buffer.from(input.rawContent, "base64");
                if (isPdfBuffer(buf)) return await extractFromPdf(buf);
            } catch {/* fallthrough */}
        }
        const text = mime.includes("html") ? stripHtml(input.rawContent) : input.rawContent;
        return { text: normalizeText(text), metadata: { mimeType: mime } };
    }

    throw new Error("No content to extract");
}

async function extractFromPdf(buffer: Buffer): Promise<ProcessedDocument> {
    // Avoid heavy dep in test env — try pdf-parse if available, else fallback
    try {
        // dynamic import so not required in all envs
        // @ts-ignore — pdf-parse is optional, not in dependencies
        const mod = await import("pdf-parse");
        const pdfParse = (mod.default ?? mod) as unknown as (buf: Buffer) => Promise<{ text: string; numpages: number; info?: unknown }>;
        const data = await pdfParse(buffer);
        return { text: normalizeText(data.text), metadata: { pages: data.numpages, extractor: "pdf-parse" } };
    } catch (err) {
        logger.warn({ err }, "pdf-parse not available or failed — falling back to raw buffer string");
        // fallback: treat as text (may be garbled but allows ingestion to proceed in tests)
        const text = buffer.toString("utf-8");
        return { text: normalizeText(text), metadata: { extractor: "fallback-raw", warning: "pdf-parse unavailable" } };
    }
}

function isPdfBuffer(buf: Buffer): boolean {
    return buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

function stripHtml(html: string): string {
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

function normalizeText(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
