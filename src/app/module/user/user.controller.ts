import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { userServices } from "./user.service";
import { AppError } from "../../utils/appError";

const uploadProfileImage = catchAsync(async (req: Request, res: Response) => {
  console.log(req.file);
  if (!req.file) {
    throw new AppError("No File Found", httpStatus.BAD_REQUEST);
  }

  const userId = req.user?.userId;

  const result = await userServices.uploadProfileImage(
    req.file?.buffer,
    userId!,
  );
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Profile Updated Successfully",
    data: result,
  });
});

export const userController = {
  uploadProfileImage,
};
