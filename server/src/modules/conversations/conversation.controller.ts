import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { apiSuccess } from "../../utils/apiSuccess.js";
import type { ConversationService } from "./conversation.service.js";

export class ConversationController {
    constructor(private readonly service: ConversationService) {}
    create = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { characterId, title } = req.body as { characterId: string; title?: string };
        const result = await this.service.create(userId, characterId, title);
        return apiSuccess(res, { statusCode: 201, message: "Conversation created", data: { conversation: result.conversation, openingMessage: result.openingMessage } });
    });
    list = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const q = req.query as unknown as { page: number; limit: number; characterId?: string; status?: string };
        const result = await this.service.listForUser(userId, { page: q.page, limit: q.limit, characterId: q.characterId, status: q.status });
        return apiSuccess(res, { message: "Conversations fetched", data: result.data, meta: result.meta });
    });
    getOne = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        const conv = await this.service.getForUser(id, userId);
        return apiSuccess(res, { message: "Conversation fetched", data: { conversation: conv } });
    });
    update = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        const conv = await this.service.update(id, userId, req.body);
        return apiSuccess(res, { message: "Conversation updated", data: { conversation: conv } });
    });
    delete = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { id } = req.params as { id: string };
        await this.service.update(id, userId, { status: "DELETED" });
        return apiSuccess(res, { message: "Conversation deleted" });
    });
}
