import { Router } from "express";
import { prisma } from "../../infrastructure/database/db.js";
import { validate } from "../../middleware/validation.middleware.js";
import { AuthRepository } from "./repositories/auth.repository.js";
import { AuthService } from "./services/auth.service.js";
import { AuthController } from "./controllers/auth.controller.js";
import { createAuthMiddleware } from "./middleware/auth.middleware.js";
import { registerSchema, loginSchema } from "./schemas/auth.schema.js";
import { authRateLimit } from "../../middleware/rate-limit.middleware.js";

const authRepository = new AuthRepository(prisma);
const authService = new AuthService(authRepository);
const authController = new AuthController(authService);
const { requireAuth } = createAuthMiddleware(authService);

const router = Router();

router.post("/register", authRateLimit, validate(registerSchema), authController.register);
router.post("/login", authRateLimit, validate(loginSchema), authController.login);
router.post("/logout", authController.logout);
router.get("/me", requireAuth, authController.me);

export default router;
export { authRepository, authService, authController, requireAuth };
