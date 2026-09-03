export function normalizeTag(tag: string): string {
    return tag.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 30);
}

export function normalizeTags(tags: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tags) {
        const t = normalizeTag(raw);
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out.slice(0, 20);
}

export function normalizeCategory(cat: string): string {
    return cat.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 50);
}

export function normalizeCategories(cats: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of cats) {
        const c = normalizeCategory(raw);
        if (!c || seen.has(c)) continue;
        seen.add(c);
        out.push(c);
    }
    return out.slice(0, 10);
}
