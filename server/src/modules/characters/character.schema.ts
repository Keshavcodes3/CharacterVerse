import { z } from "zod";

export const createCharacterSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Only lowercase alphanumeric and hyphen").optional(),
    description: z.string().min(1).max(5000),
    greeting: z.string().min(1).max(5000),
    avatarUrl: z.string().url().optional().nullable(),
    visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).default("PUBLIC"),
    category: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    personality: z.object({
      traits: z.any().optional(),
      backstory: z.string().optional(),
      personality: z.string().optional(),
      lore: z.string().optional().nullable(),
      knowledge: z.string().optional().nullable(),
      scenario: z.string().optional().nullable(),
      exampleDialogues: z.any().optional().nullable(),
    }).optional(),
  }),
});

export const updateCharacterSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().min(1).max(5000).optional(),
    greeting: z.string().min(1).max(5000).optional(),
    avatarUrl: z.string().url().optional().nullable(),
    visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).optional(),
    category: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const getCharacterParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid().or(z.string().min(1)),
  }),
});

export const listCharactersQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    category: z.string().optional(),
    sortBy: z.enum(["createdAt", "updatedAt", "name"]).default("createdAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
  }),
});

export type CreateCharacterInput = z.infer<typeof createCharacterSchema>["body"];
export type UpdateCharacterInput = z.infer<typeof updateCharacterSchema>["body"];
