import { NextFunction, Request, Response, Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { DoctorController } from "./doctor.controller";
import { upload } from "../../lib/multer";

const router = Router();

router.post(
  "/apply-as-doctor",
  upload.fields([
    {
      name: "resume",
      maxCount: 1,
    },
    {
      name: "additionalFiles",
      maxCount: 10,
    },
  ]),

  DoctorController.applyAsDoctor,
);

router.post(
  "/approved-doctor",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  DoctorController.approvedDoctor,
);

router.post(
  "/apply-as-doctor/verify-email",

  DoctorController.verifiedDoctorEmail,
);

router.get(
  "/all-doctors",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  DoctorController.getAllDoctors,
);

export const DoctorRoutes = router;
