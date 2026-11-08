export class AppError extends Error {
    public statusCode: number;

    constructor(message: string, statusCode: number , stack = "") {
        super(message); // Call the parent class constructor with the error message
        this.statusCode = statusCode;
        if (stack) {
            this.stack = stack;
        }else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}