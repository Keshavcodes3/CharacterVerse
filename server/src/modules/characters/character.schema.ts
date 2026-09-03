import { z } from "zod";

const visibilityEnum = z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]);
const slugRegex = /^[a-z0-9-]+$/;

export const createCharacterSchema = z.object({
    body: z.object({
        name: z.string().min(1, "Name is required").max(100).trim(),
        slug: z
            .string()
            .min(1)
            .max(100)
            .regex(slugRegex, "Slug must be lowercase alphanumeric and hyphen")
            .optional(),
        description: z.string().min(1, "Description is required").max(5000),
        greeting: z.string().min(1, "Greeting is required").max(5000),
        avatarUrl: z.string().url().optional().nullable(),
        visibility: visibilityEnum.default("PUBLIC"),
        category: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
        tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
        personality: z
            .object({
                traits: z.unknown().optional(),
                backstory: z.string().max(10000).optional(),
                personality: z.string().max(10000).optional(),
                lore: z.string().max(10000).optional().nullable(),
                knowledge: z.string().max(10000).optional().nullable(),
                scenario: z.string().max(10000).optional().nullable(),
                exampleDialogues: z.unknown().optional().nullable(),
            })
            .optional(),
        examples: z
            .array(
                z.object({
                    title: z.string().max(200).optional(),
                    content: z.string().min(1).max(10000),
                    isDialogue: z.boolean().default(true).optional(),
                })
            )
            .max(20)
            .optional(),
    }),
});

export const updateCharacterSchema = z.object({
    params: z.object({
        id: z.string().min(1, "Character id/slug required"),
    }),
    body: z
        .object({
            name: z.string().min(1).max(100).trim().optional(),
            description: z.string().min(1).max(5000).optional(),
            greeting: z.string().min(1).max(5000).optional(),
            avatarUrl: z.string().url().optional().nullable(),
            visibility: visibilityEnum.optional(),
            category: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
            tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
            personality: z
                .object({
                    traits: z.unknown().optional(),
                    backstory: z.string().max(10000).optional(),
                    personality: z.string().max(10000).optional(),
                    lore: z.string().max(10000).optional().nullable(),
                    knowledge: z.string().max(10000).optional().nullable(),
                    scenario: z.string().max(10000).optional().nullable(),
                    exampleDialogues: z.unknown().optional().nullable(),
                })
                .optional(),
            examples: z
                .array(
                    z.object({
                        title: z.string().max(200).optional(),
                        content: z.string().min(1).max(10000),
                        isDialogue: z.boolean().optional(),
                    })
                )
                .max(20)
                .optional(),
        })
        .refine((d) => Object.keys(d).length > 0, { message: "At least one field required" }),
});

export const getCharacterParamsSchema = z.object({
    params: z.object({
        id: z.string().min(1),
    }),
});

export const deleteCharacterParamsSchema = z.object({
    params: z.object({
        id: z.string().min(1),
    }),
});

export const listCharactersQuerySchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        search: z.string().trim().min(1).max(200).optional(),
        category: z.string().trim().optional(),
        tags: z.string().trim().optional(), // comma separated
        sortBy: z.enum(["createdAt", "updatedAt", "name"]).default("createdAt"),
        order: z.enum(["asc", "desc"]).default("desc"),
        creatorId: z.string().uuid().optional(),
        visibility: visibilityEnum.optional(),
    }),
});

export const likeParamsSchema = z.object({
    params: z.object({ id: z.string().min(1) }),
});

export const bookmarkParamsSchema = z.object({
    params: z.object({ id: z.string().min(1) }),
});

export type CreateCharacterInput = z.infer<typeof createCharacterSchema>["body"];
export type UpdateCharacterInput = z.infer<typeof updateCharacterSchema>["body"];
export type ListCharactersQuery = z.infer<typeof listCharactersQuerySchema>["query"];
