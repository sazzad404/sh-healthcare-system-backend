import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { DoctorServices } from "./doctor.service";

import httpStatus from "http-status";
import { sendResponse } from "../../utils/sendResponse";
import { applyAsDoctorValidationZodSchema } from "./doctor.validation";
import { AppError } from "../../utils/appError";

const applyAsDoctor = catchAsync(async (req: Request, res: Response) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };

  const resume = files?.["resume"] ? files["resume"][0] : null;
  const additionalFiles = files?.["additionalFiles"] || [];

  const ZodValidationResult = applyAsDoctorValidationZodSchema.safeParse(
    JSON.parse(req.body.data),
  );

  if (!ZodValidationResult.success) {
    throw new AppError(ZodValidationResult.error.issues[0].message, httpStatus.BAD_REQUEST);
  }

  const payload = ZodValidationResult.data;

  const result = await DoctorServices.applyAsDoctor(
    payload,
    resume,
    additionalFiles,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor Applied Successfully",
    data: result,
  });
});

const approvedDoctor = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user!;

  const result = await DoctorServices.approvedDoctor(payload, user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor Approved Successfully",
    data: result,
  });
});
const getAllDoctors = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await DoctorServices.getAllDoctors(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctors Retrieved Successfully",
    data: data,
    meta: meta,
  });
});
const verifiedDoctorEmail = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  const result = DoctorServices.verifyDoctorEmail(payload);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor Email Verified Successfully",
    data: result,
  });
});

export const DoctorController = {
  applyAsDoctor,
  verifiedDoctorEmail,
  approvedDoctor,
  getAllDoctors,
};
