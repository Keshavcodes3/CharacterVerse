export class ApiError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly details?: unknown;
    public readonly isOperational: boolean;

    constructor(
        statusCode: number,
        message: string,
        code = "INTERNAL_SERVER_ERROR",
        details?: unknown
    ) {
        super(message);

        this.name = "ApiError";
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}