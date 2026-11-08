import z from "zod";
import { catchAsync } from "../utils/catchAsync";
import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/appError";
import httpStatus from "http-status";

export const validateRequest = (zodSchema: z.ZodObject) => {
  return catchAsync((req: Request, res: Response, next: NextFunction) => {
    const payload = req.body ?? {};

    const result = zodSchema.safeParse(payload);
    if (!result.success) {
      let errorMessage = "";
      result.error.issues.forEach((issue) => {
        errorMessage = errorMessage + issue.message + ", ";
      });
      throw new AppError(errorMessage, httpStatus.BAD_REQUEST);
    }

    req.body = result.data;
    next();
  });
};
