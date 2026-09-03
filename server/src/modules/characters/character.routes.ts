import { Router } from "express";
import { prisma } from "../../infrastructure/database/db.js";
import { validate } from "../../middleware/validation.middleware.js";
import { createAuthMiddleware } from "../auth/middleware/auth.middleware.js";
import { AuthRepository } from "../auth/repositories/auth.repository.js";
import { AuthService } from "../auth/services/auth.service.js";
import { CharacterRepository } from "./character.repository.js";
import { CharacterService } from "./character.service.js";
import { CharacterController } from "./character.controller.js";
import {
    createCharacterSchema,
    updateCharacterSchema,
    getCharacterParamsSchema,
    listCharactersQuerySchema,
    likeParamsSchema,
    bookmarkParamsSchema,
    deleteCharacterParamsSchema,
} from "./character.schema.js";


const authRepository = new AuthRepository(prisma);
const authService = new AuthService(authRepository);
const { requireAuth } = createAuthMiddleware(authService);

const characterRepository = new CharacterRepository(prisma);
const characterService = new CharacterService(characterRepository);
const characterController = new CharacterController(characterService);

const router = Router();

// Optional auth middleware - attaches user if session present, but doesn't fail
const optionalAuth: typeof requireAuth = async (req, _res, next) => {
    try {
        // reuse requireAuth but swallow 401
        await new Promise<void>((resolve, reject) => {
            requireAuth(req as never, _res as never, (err?: unknown) => {
                if (err) return reject(err);
                resolve();
            });
        });
        return next();
    } catch {
        // unauthenticated -> continue as guest
        return next();
    }
};

// Authenticated (must be before /:id to avoid param collision)
router.get("/me/mine", requireAuth, validate(listCharactersQuerySchema), characterController.listMine);
router.post("/", requireAuth, validate(createCharacterSchema), characterController.create);

// Public
router.get("/", validate(listCharactersQuerySchema), optionalAuth, characterController.list);
router.get("/:id", validate(getCharacterParamsSchema), optionalAuth, characterController.getOne);

router.patch("/:id", requireAuth, validate(updateCharacterSchema), characterController.update);
router.delete("/:id", requireAuth, validate(deleteCharacterParamsSchema), characterController.delete);

router.post("/:id/like", requireAuth, validate(likeParamsSchema), characterController.toggleLike);
router.post("/:id/bookmark", requireAuth, validate(bookmarkParamsSchema), characterController.toggleBookmark);

export default router;
export { characterRepository, characterService, characterController };
