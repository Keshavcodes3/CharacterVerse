import { z } from "zod";
import {
    USERNAME_REGEX,
    USERNAME_MIN_LENGTH,
    USERNAME_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH,
} from "../../../config/constants.js";

export const registerSchema = z.object({
    body: z.object({
        username: z
            .string()
            .min(USERNAME_MIN_LENGTH, `Username must be at least ${USERNAME_MIN_LENGTH} characters`)
            .max(USERNAME_MAX_LENGTH, `Username must be at most ${USERNAME_MAX_LENGTH} characters`)
            .regex(USERNAME_REGEX, "Username may only contain letters, numbers and underscore"),
        email: z.string().email("Invalid email").max(254).transform((v) => v.toLowerCase().trim()),
        password: z
            .string()
            .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
            .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`),
    }),
});

export const loginSchema = z.object({
    body: z.object({
        email: z.string().email("Invalid email").max(254).transform((v) => v.toLowerCase().trim()),
        password: z.string().min(1, "Password is required").max(PASSWORD_MAX_LENGTH),
    }),
});

export type RegisterBody = z.infer<typeof registerSchema>["body"];
export type LoginBody = z.infer<typeof loginSchema>["body"];
