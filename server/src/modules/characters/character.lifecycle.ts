import { ApiError } from "../../utils/apiError.js";
import type { CharacterStatus } from "../../generated/prisma/client.js";

/**
 * Explicit state machine for Character lifecycle
 * DRAFT -> PUBLISHED -> ARCHIVED
 * PUBLISHED <-> SUSPENDED
 * Any -> DELETED (via delete, not status transition)
 */
export const CHARACTER_TRANSITIONS: Record<CharacterStatus, CharacterStatus[]> = {
    DRAFT: ["PUBLISHED", "ARCHIVED", "DELETED"],
    PUBLISHED: ["ARCHIVED", "SUSPENDED", "DELETED"],
    SUSPENDED: ["PUBLISHED", "ARCHIVED", "DELETED"],
    ARCHIVED: ["DRAFT", "DELETED"], // restore to draft
    DELETED: [], // terminal
};

export function canTransition(from: CharacterStatus, to: CharacterStatus): boolean {
    return (CHARACTER_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: CharacterStatus, to: CharacterStatus): void {
    if (!canTransition(from, to)) {
        throw new ApiError(400, `Invalid status transition ${from} -> ${to}`, "INVALID_STATUS_TRANSITION");
    }
}

export const PUBLICATION_REQUIREMENTS = {
    nameMin: 1,
    descriptionMin: 10,
    greetingMin: 10,
    personalityMin: 10,
} as const;

export function assertCanPublish(input: { name?: string; description?: string; greeting?: string; personality?: string | null }) {
    if (!input.name || input.name.trim().length < PUBLICATION_REQUIREMENTS.nameMin) {
        throw new ApiError(400, "Name required to publish", "PUBLISH_REQUIREMENT");
    }
    if (!input.description || input.description.trim().length < PUBLICATION_REQUIREMENTS.descriptionMin) {
        throw new ApiError(400, "Description too short to publish (min 10 chars)", "PUBLISH_REQUIREMENT");
    }
    if (!input.greeting || input.greeting.trim().length < PUBLICATION_REQUIREMENTS.greetingMin) {
        throw new ApiError(400, "Greeting too short to publish", "PUBLISH_REQUIREMENT");
    }
}
