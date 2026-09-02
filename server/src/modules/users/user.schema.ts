import { z } from "zod";

export const updateProfileSchema = z.object({
  body: z.object({
    displayName: z.string().min(1).max(50).optional(),
    bio: z.string().max(1000).optional().nullable(),
    avatarUrl: z.string().url().optional().nullable(),
    bannerUrl: z.string().url().optional().nullable(),
  }),
});

export const updatePreferencesSchema = z.object({
  body: z.object({
    theme: z.enum(["LIGHT", "DARK"]).optional(),
    language: z.string().min(2).max(10).optional(),
    timezone: z.string().optional(),
    nsfwEnabled: z.boolean().optional(),
    emailNotifications: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
  }),
});

export const getUserParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid().or(z.string().min(1)),
  }),
});

export const updateUserSchema = z.object({
  body: z.object({
    username: z.string().min(3).max(30).optional(),
    email: z.string().email().optional(),
    bio: z.string().max(1000).optional().nullable(),
    avatarUrl: z.string().url().optional().nullable(),
  }),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>["body"];
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>["body"];
