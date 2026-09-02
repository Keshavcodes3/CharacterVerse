import { z } from "zod";

export const createConversationSchema = z.object({
  body: z.object({
    characterId: z.string().uuid(),
    title: z.string().max(200).optional().nullable(),
  }),
});

export const getConversationParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const listConversationsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    characterId: z.string().uuid().optional(),
    status: z.enum(["ACTIVE", "ARCHIVED", "DELETED"]).optional(),
  }),
});

export const updateConversationSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    title: z.string().max(200).optional().nullable(),
    summary: z.string().max(5000).optional().nullable(),
    status: z.enum(["ACTIVE", "ARCHIVED", "DELETED"]).optional(),
  }),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>["body"];
