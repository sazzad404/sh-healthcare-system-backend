import { Router } from "express";
import { appointmentController } from "./appointment.controller";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.post(
  "/book-appointment",
  auth(Role.PATIENT),
  appointmentController.bookAppointment,
);
router.post(
  "/pay-appointment",
  auth(Role.PATIENT),
  appointmentController.payAppointment,
);
router.post(
  "/cancel-appointment",
  auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN),
  appointmentController.cancelAppointment,
);
router.get(
  "/book-appointment/payment/callback",
  appointmentController.bookAppointmentCallBack,
);

export const AppointmentRoutes = router;
