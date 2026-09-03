import { Router } from "express";
import { prisma } from "../../infrastructure/database/db.js";
import { createAuthMiddleware } from "../auth/middleware/auth.middleware.js";
import { AuthRepository } from "../auth/repositories/auth.repository.js";
import { AuthService } from "../auth/services/auth.service.js";
import { DiscoveryController } from "./discovery.controller.js";

const authRepo = new AuthRepository(prisma);
const authService = new AuthService(authRepo);
const { requireAuth } = createAuthMiddleware(authService);

// optional auth — discovery is public but recommended is personalized
const optionalAuth: typeof requireAuth = async (req, _res, next) => {
    try {
        await new Promise<void>((resolve, reject) => {
            requireAuth(req as any, _res as any, (err?: unknown) => (err ? reject(err) : resolve()));
        });
        return next();
    } catch {
        return next();
    }
};

import { searchRateLimit } from "../../middleware/rate-limit.middleware.js";

const controller = new DiscoveryController();
const router = Router();

router.get("/discovery/trending", searchRateLimit, optionalAuth, controller.trending);
router.get("/discovery/popular", searchRateLimit, optionalAuth, controller.popular);
router.get("/discovery/new", searchRateLimit, optionalAuth, controller.newChars);
router.get("/discovery/recommended", searchRateLimit, optionalAuth, controller.recommended);
router.get("/discovery/search", searchRateLimit, optionalAuth, controller.search);
router.get("/discovery/slug/:slug", optionalAuth, controller.getBySlug);

export default router;
