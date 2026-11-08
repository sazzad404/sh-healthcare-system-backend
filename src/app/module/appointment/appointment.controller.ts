import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { AppointmentServices } from "./appointment.service";
import { zhCN } from "zod/locales";

const bookAppointment = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user!;
  const result = await AppointmentServices.bookAppointment(payload, user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment Payment Initiated successfully",
    data: result,
  });
});
const payAppointment = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user!;
  const result = await AppointmentServices.payAppointment(payload, user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment Payment Initiated successfully",
    data: result,
  });
});

const bookAppointmentCallBack = catchAsync(
  async (req: Request, res: Response) => {
    console.log("Callback Query:", req.query);
    const { redirectURL } = await AppointmentServices.bookAppointmentCallBack(
      req.query,
    );

    res.redirect(redirectURL);
  },
);

const cancelAppointment = catchAsync(async (req: Request, res: Response) => {
  const result = await AppointmentServices.cancelAppointment(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment Cancell and Refund Successfully",
    data: result,
  });
});

export const appointmentController = {
  bookAppointment,
  bookAppointmentCallBack,
  payAppointment,
  cancelAppointment,
};
