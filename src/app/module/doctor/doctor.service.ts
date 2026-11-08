import { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma";
import { cloudinary } from "../../lib/cloudinary";
import bcrypt from "bcryptjs";
import config from "../../config";
import {
  doctorVerificationStatus,
  Role,
} from "../../../generated/prisma/enums";
import crypto from "crypto";
import { radisClient } from "../../lib/radis";
import path from "path";
import { transporter } from "../../lib/nodemailer";
import ejs from "ejs";
import {
  IApplyAsDoctor,
  IApproveDoctor,
  IVerifiedDoctorEmailPayload,
} from "./doctor.interface";
import { RedisClient } from "redis";
import { RequestUser } from "../../middleware/checkAuth";
import { IQuery } from "../../interfaces";
import { DoctorWhereInput } from "../../../generated/prisma/models";
import { AppError } from "../../utils/appError";
import httpStatus from "http-status";

const applyAsDoctor = async (
  payload: IApplyAsDoctor,
  resume: Express.Multer.File | null,
  additionalFiles: Express.Multer.File[],
) => {
  const isUserExists = await prisma.user.findUnique({
    where: {
      email: payload.user.email,
    },
  });

  if (isUserExists) {
    throw new AppError(
      "User already exists with this email",
      httpStatus.CONFLICT,
    );
  }

  const resumeUploadResult = await new Promise<UploadApiResponse>(
    (resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            resource_type: "auto",
          },

          async (error, result) => {
            if (error) {
              return reject(error);
            }
            if (!result) {
              return reject(
                new AppError(
                  "No result returned from Cloudinary",
                  httpStatus.INTERNAL_SERVER_ERROR,
                ),
              );
            }
            resolve(result);
          },
        )
        .end(resume?.buffer);
    },
  );

  const additionalFilesUploadResult = await Promise.all(
    additionalFiles.map((file) => {
      return new Promise<UploadApiResponse>((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              resource_type: "auto",
            },

            async (error, result) => {
              if (error) {
                return reject(error);
              }
              if (!result) {
                return reject(
                  new AppError(
                    "No result returned from Cloudinary",
                    httpStatus.INTERNAL_SERVER_ERROR,
                  ),
                );
              }
              resolve(result);

              // return result;
            },
          )
          .end(file?.buffer);
      });
    }),
  );

  const randomDoctorPassword = Math.random().toString(36).slice(-8);

  const hashedPassword = await bcrypt.hash(
    randomDoctorPassword,
    Number(config.bcrypt_salt_rounds),
  );

  const doctorApplication = await prisma.user.create({
    data: {
      ...payload.user,
      password: hashedPassword,
      role: Role.DOCTOR,
      needPasswordChange: true,
      doctor: {
        create: {
          name: payload.user.name,
          email: payload.user.email,
          ...payload.doctor,
          resume: resumeUploadResult.secure_url,
          resumePublicId: resumeUploadResult.public_id,
          additionalFiles: additionalFilesUploadResult.map((file) => ({
            url: file.secure_url,
            publicId: file.public_id,
          })),
        },
      },
    },

    include: {
      doctor: true,
    },
  });

  const expirationSecond = 60 * 60;
  const otpKey = `doctor-application-otp:${payload.user.email}`;

  const otpValue = crypto.randomInt(100000, 1000000).toString();

  await radisClient.set(otpKey, otpValue, {
    expiration: {
      type: "EX",
      value: expirationSecond,
    },
  });

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/registration-user-otp.ejs",
  );

  const templateData = {
    name: payload.user.name,
    // email: payload.user.email,
    OTP: otpValue,
    expirationMinutes: expirationSecond / 60,
  };

  const html = await ejs.renderFile(templatePath, templateData);

  await transporter.sendMail({
    from: config.email_sender,
    to: payload.user.email,
    subject: "Doctor Application - Email Verification",
  });

  return doctorApplication;
};

const verifyDoctorEmail = async (payload: IVerifiedDoctorEmailPayload) => {
  const email = payload.email.trim().toLocaleLowerCase();
  const otp = payload.otp;

  const existingUser = await prisma.user.findUnique({
    where: {
      email,
      role: Role.DOCTOR,
    },
  });

  if (!existingUser) {
    throw new AppError(
      "Doctor application not found, please try again later",
      httpStatus.NOT_FOUND,
    );
  }

  if (existingUser.emailVerified) {
    throw new AppError("Email already verified", httpStatus.BAD_REQUEST);
  }

  const otpKey = `doctor-application-otp:${email}`;
  const redisOtp = await radisClient.get(otpKey);

  if (!redisOtp) {
    throw new AppError(
      "OTP expired. Your application window has closed, please apply again",
      httpStatus.BAD_REQUEST,
    );
  }

  if (redisOtp !== otp) {
    throw new AppError("OTP does not match", httpStatus.BAD_REQUEST);
  }

  await radisClient.del(otpKey);

  const verifiedUser = await prisma.user.update({
    where: {
      id: existingUser.id,
    },
    data: {
      emailVerified: true,
    },
    omit: {
      password: true,
    },
    include: {
      doctor: true,
    },
  });

  return verifiedUser;
};

const approvedDoctor = async (
  payload: IApproveDoctor,
  reviewer: RequestUser,
) => {
  const { doctorId, verificationStatus, rejectionReason } = payload;

  const existingDoctor = await prisma.doctor.findUnique({
    where: {
      id: doctorId,
    },
    include: {
      user: true,
    },
  });

  if (!existingDoctor) {
    throw new AppError("Doctor application not found", httpStatus.NOT_FOUND);
  }

  if (existingDoctor.isDeleted) {
    throw new AppError(
      "Doctor application has been deleted",
      httpStatus.BAD_REQUEST,
    );
  }

  if (!existingDoctor.user.emailVerified) {
    throw new AppError(
      "Doctor has not verified their email yet. Application cannot be reviewed",
      httpStatus.BAD_REQUEST,
    );
  }
  if (existingDoctor.verificationStatus !== doctorVerificationStatus.PENDING) {
    throw new AppError(
      `Doctor application has already been ${verificationStatus.toLocaleLowerCase()}`,
      httpStatus.BAD_REQUEST,
    );
  }

  if (
    verificationStatus === doctorVerificationStatus.REJECTED &&
    !rejectionReason
  ) {
    throw new AppError(
      "Rejection reason is required when rejecting a doctor application",
      httpStatus.BAD_REQUEST,
    );
  }

  const updateDoctor = await prisma.doctor.update({
    where: {
      id: doctorId,
    },
    data: {
      verificationStatus,
      rejectionReason:
        verificationStatus === doctorVerificationStatus.REJECTED
          ? rejectionReason
          : null,
      reviewedBy: reviewer.userId,
      reviewedAt: new Date(),
    },
  });

  const templatePath = path.join(
    process.cwd(),
    `src/app/templates/doctor-application-${verificationStatus.toLowerCase()}.ejs`,
  );

  const html = await ejs.renderFile(templatePath, {
    name: existingDoctor.name,
    rejectionReason,
    loginUrl: config.frontend_url + "/login",
  });

  await transporter.sendMail({
    from: config.email_sender,
    to: existingDoctor.email,
    subject:
      verificationStatus === doctorVerificationStatus.APPROVED
        ? "Doctor Application Approved - SH Healthcare System"
        : "Doctor Application Update - SH Healthcare System",
    html,
  });

  return updateDoctor;
};

const getAllDoctors = async (query: IQuery) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder ? query.sortOrder : "desc";

  const andConditions: DoctorWhereInput[] = [];

  // Searching by searchTerm in name, email, specialization, licenseNumber
  if (query.searchTerm) {
    andConditions.push({
      OR: [
        { name: { contains: query.searchTerm, mode: "insensitive" } },
        { email: { contains: query.searchTerm, mode: "insensitive" } },
        { specialization: { contains: query.searchTerm, mode: "insensitive" } },
        { licenseNumber: { contains: query.searchTerm, mode: "insensitive" } },
      ],
    });
  }

  // Filtering by name if provided

  if (query.name) {
    andConditions.push({
      name: { equals: query.name, mode: "insensitive" },
    });
  }

  if (query.specialization) {
    andConditions.push({
      specialization: { equals: query.specialization, mode: "insensitive" },
    });
  }

  if (query.licenseNumber) {
    andConditions.push({
      licenseNumber: { equals: query.licenseNumber, mode: "insensitive" },
    });
  }

  if (query.email) {
    andConditions.push({
      email: { equals: query.email, mode: "insensitive" },
    });
  }
  if (query.verificationStatus) {
    andConditions.push({
      verificationStatus: { equals: query.verificationStatus },
    });
  }

  andConditions.push({
    isDeleted: false,
  });

  const allDoctors = prisma.doctor.findMany({
    where: {
      AND: andConditions.length > 0 ? andConditions : undefined,
    },
    take: limit,
    skip: skip,
    orderBy: {
      [sortBy]: sortOrder,
    },
    include: {
      user: {
        omit: {
          password: true,
        },
      },
    },
  });

  const totalDoctorCount = await prisma.doctor.count({
    where: {
      AND: andConditions.length > 0 ? andConditions : undefined,
    },
  });



  return{
    data: allDoctors,
    meta: {
      total: totalDoctorCount,
      page: page,
      limit: limit,
      totalPages: Math.ceil(totalDoctorCount / limit),
    },
  }
};

export const DoctorServices = {
  applyAsDoctor,
  verifyDoctorEmail,
  approvedDoctor,
  getAllDoctors,
};
