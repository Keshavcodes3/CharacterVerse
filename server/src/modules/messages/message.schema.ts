import { z } from "zod";

export const createMessageSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid(),
  }),
  body: z.object({
    content: z.string().min(1).max(10000),
    role: z.enum(["USER", "CHARACTER", "SYSTEM"]).default("USER"),
    attachments: z.any().optional().nullable(),
    metadata: z.any().optional().nullable(),
  }),
});

export const listMessagesQuerySchema = z.object({
  params: z.object({
    conversationId: z.string().uuid(),
  }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime().optional(),
    after: z.string().datetime().optional(),
  }),
});

export const getMessageParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
  }),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>["body"];
