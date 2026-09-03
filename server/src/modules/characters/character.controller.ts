import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { apiSuccess } from "../../utils/apiSuccess.js";
import type { CharacterService } from "./character.service.js";

export class CharacterController {
    constructor(private readonly characterService: CharacterService) {}

    create = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const character = await this.characterService.create({
            creatorId: userId,
            ...req.body,
        });
        return apiSuccess(res, {
            statusCode: 201,
            message: "Character created",
            data: { character },
        });
    });

    getOne = asyncHandler(async (req: Request, res: Response) => {
        const { id } = req.params as { id: string };
        const requesterId = req.user?.id;
        const role = (req.user as unknown as { role?: string })?.role;
        const character = await this.characterService.getByIdOrSlug(id, requesterId, role);
        return apiSuccess(res, {
            message: "Character fetched",
            data: { character },
        });
    });

    list = asyncHandler(async (req: Request, res: Response) => {
        const query = req.query as unknown as {
            page: number;
            limit: number;
            search?: string;
            category?: string;
            tags?: string;
            sortBy: "createdAt" | "updatedAt" | "name";
            order: "asc" | "desc";
            creatorId?: string;
            visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE";
        };

        const tagsArray = query.tags
            ? query.tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
            : undefined;

        const result = await this.characterService.list(
            {
                page: query.page,
                limit: query.limit,
                search: query.search,
                category: query.category,
                tags: tagsArray,
                sortBy: query.sortBy,
                order: query.order,
                creatorId: query.creatorId,
                visibility: query.visibility,
            },
            req.user?.id
        );

        return apiSuccess(res, {
            message: "Characters fetched",
            data: result.data,
            meta: result.meta,
        });
    });

    listMine = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const query = req.query as unknown as {
            page: number;
            limit: number;
            search?: string;
            category?: string;
            tags?: string;
            sortBy: "createdAt" | "updatedAt" | "name";
            order: "asc" | "desc";
        };
        const tagsArray = query.tags
            ? query.tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
            : undefined;

        const result = await this.characterService.listMyCharacters(userId, {
            page: query.page,
            limit: query.limit,
            search: query.search,
            category: query.category,
            tags: tagsArray,
            sortBy: query.sortBy,
            order: query.order,
        });

        return apiSuccess(res, {
            message: "My characters fetched",
            data: result.data,
            meta: result.meta,
        });
    });

    update = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        const role = (req.user as unknown as { role?: string })?.role;
        const character = await this.characterService.update(id, userId, req.body, role);
        return apiSuccess(res, {
            message: "Character updated",
            data: { character },
        });
    });

    delete = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        const role = (req.user as unknown as { role?: string })?.role;
        await this.characterService.delete(id, userId, role);
        return apiSuccess(res, { message: "Character deleted" });
    });

    publish = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        const role = (req.user as unknown as { role?: string })?.role;
        const character = await this.characterService.publish(id, userId, role);
        return apiSuccess(res, { message: "Character published", data: { character } });
    });
    archive = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        const role = (req.user as unknown as { role?: string })?.role;
        const character = await this.characterService.archive(id, userId, role);
        return apiSuccess(res, { message: "Character archived", data: { character } });
    });
    suspend = asyncHandler(async (req: Request, res: Response) => {
        const { id } = req.params as { id: string };
        const role = (req.user as unknown as { role?: string })?.role;
        const character = await this.characterService.suspend(id, req.user!.id, role);
        return apiSuccess(res, { message: "Character suspended", data: { character } });
    });
    restore = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        const role = (req.user as unknown as { role?: string })?.role;
        const character = await this.characterService.restore(id, userId, role);
        return apiSuccess(res, { message: "Character restored", data: { character } });
    });
    duplicate = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        const character = await this.characterService.duplicate(id, userId);
        return apiSuccess(res, { statusCode: 201, message: "Character duplicated", data: { character } });
    });

    toggleLike = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        const result = await this.characterService.toggleLike(id, userId);
        return apiSuccess(res, { message: result.liked ? "Liked" : "Unliked", data: result });
    });

    toggleBookmark = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        const result = await this.characterService.toggleBookmark(id, userId);
        return apiSuccess(res, { message: result.bookmarked ? "Bookmarked" : "Unbookmarked", data: result });
    });
}
