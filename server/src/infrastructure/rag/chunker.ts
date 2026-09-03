export interface ChunkOptions {
    chunkSize?: number; // chars, default 800
    overlap?: number; // chars, default 150
    strategy?: "recursive" | "fixed" | "paragraph";
}

export interface Chunk {
    content: string;
    chunkIndex: number;
    section?: string | null;
    page?: number | null;
    metadata?: Record<string, unknown>;
}

function splitRecursive(text: string, chunkSize: number, overlap: number): string[] {
    const separators = ["\n\n", "\n", ". ", " "];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + chunkSize, text.length);
        if (end < text.length) {
            let found = -1;
            for (const sep of separators) {
                const idx = text.lastIndexOf(sep, end);
                if (idx > start + chunkSize * 0.5) { found = idx + sep.length; break; }
            }
            if (found !== -1) end = found;
        }
        const slice = text.slice(start, end).trim();
        if (slice) chunks.push(slice);
        if (end >= text.length) break;
        start = end - overlap;
        if (start < 0) start = 0;
    }
    return chunks;
}

function splitParagraph(text: string, chunkSize: number, overlap: number): string[] {
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = "";
    for (const p of paragraphs) {
        if ((current + "\n\n" + p).length > chunkSize && current) {
            chunks.push(current);
            // overlap: carry last ~overlap chars
            const carry = current.slice(-overlap);
            current = carry + "\n\n" + p;
        } else {
            current = current ? current + "\n\n" + p : p;
        }
    }
    if (current) chunks.push(current);
    // if still oversized, recursive
    const final: string[] = [];
    for (const c of chunks) if (c.length > chunkSize * 1.5) final.push(...splitRecursive(c, chunkSize, overlap)); else final.push(c);
    return final;
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
    const chunkSize = opts.chunkSize ?? 800;
    const overlap = opts.overlap ?? 150;
    const strategy = opts.strategy ?? "recursive";
    const normalized = text.replace(/\r\n/g, "\n").trim();
    if (!normalized) return [];

    let parts: string[];
    if (strategy === "paragraph") parts = splitParagraph(normalized, chunkSize, overlap);
    else if (strategy === "fixed") {
        parts = [];
        for (let i = 0; i < normalized.length; i += chunkSize - overlap) parts.push(normalized.slice(i, i + chunkSize).trim());
    } else parts = splitRecursive(normalized, chunkSize, overlap);

    return parts.map((content, i) => ({
        content,
        chunkIndex: i,
        section: undefined,
        page: undefined,
        metadata: { chunkSize, overlap, strategy },
    }));
}

export function chunkMarkdown(markdown: string, opts: ChunkOptions = {}): Chunk[] {
    // split by headings to preserve section
    const sections = markdown.split(/(?=^#{1,6}\s)/m);
    const all: Chunk[] = [];
    let globalIdx = 0;
    for (const sec of sections) {
        const trimmed = sec.trim();
        if (!trimmed) continue;
        const heading = trimmed.match(/^#{1,6}\s(.+)$/m)?.[1]?.trim() ?? null;
        const chunks = chunkText(trimmed, opts);
        for (const c of chunks) {
            all.push({ ...c, chunkIndex: globalIdx++, section: heading, metadata: { ...c.metadata, heading } });
        }
    }
    return all.length ? all : chunkText(markdown, opts);
}
