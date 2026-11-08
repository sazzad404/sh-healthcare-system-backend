import bcrypt from "bcryptjs";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import {
  AuthProvider,
  Role,
  UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { jwtUtils } from "../../utils/jwt";
import type {
  IForgotPasswordPayload,
  IGoogleLoginPayload,
  ILoginUserPayload,
  IRegisterPatientPayload,
  IRequestUser,
  IResetPasswordPayload,
  IVerifyEmailPayload,
} from "./auth.interface";
import { OAuth2Client, TokenPayload } from "google-auth-library";
import { googleCLient } from "../../lib/googleAuth";
import crypto from "crypto";
import { radisClient } from "../../lib/radis";
import { transporter } from "../../lib/nodemailer";
import ejs from "ejs";
import path from "path";
import { AppError } from "../../utils/appError";
import httpStatus from "http-status";

const registerPatient = async (payload: IRegisterPatientPayload) => {
  const { name, password, patient: patientData } = payload;

  const email = payload.email.trim().toLowerCase();

  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (isUserExists) {
    throw new AppError(
      "User with this email already exists",
      httpStatus.CONFLICT,
    );
  }

  const hashedPassword = await bcrypt.hash(password, 8);

  // create otp and otp key for register
  const otpValue = crypto.randomInt(100000, 1000000).toString();

  const otpKey = `patient-registration-otp:${email}`;

  const expirationSeconds = 5 * 60;
  await radisClient.set(otpKey, otpValue, {
    expiration: {
      type: "EX",
      value: expirationSeconds,
    },
  });

  //   create datakey or data into redis

  const patientRegistrationKey = `patient-registration-data:${email}`;
  const radisUserDataPayload = {
    name,
    email,
    password: hashedPassword,
    patient: patientData,
  };

  await radisClient.set(
    patientRegistrationKey,
    JSON.stringify(radisUserDataPayload),
    {
      expiration: {
        type: "EX",
        value: expirationSeconds,
      },
    },
  );

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/registration-user-otp.ejs",
  );

  const html = await ejs.renderFile(templatePath, {
    name,
    OTP: otpValue,
    expirationMinutes: expirationSeconds / 60,
  });
  await transporter.sendMail({
    from: config.email_sender,
    to: email,
    subject: "Email Verification",
    html,
  });
};

const verifyPatientEmail = async (payload: IVerifyEmailPayload) => {
  const otp = payload.otp;
  const email = payload.email.trim().toLowerCase();

  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (isUserExists?.emailVerified) {
    throw new AppError("User Not Verified", httpStatus.BAD_REQUEST);
  }

  if (isUserExists?.status === "BLOCKED") {
    throw new AppError("User is Blocked", httpStatus.FORBIDDEN);
  }
  if (isUserExists?.emailVerified) {
    throw new AppError("User already verified", httpStatus.BAD_REQUEST);
  }
  if (isUserExists?.isDeleted || isUserExists?.status === "DELETED") {
    throw new AppError("User is Deleted", httpStatus.FORBIDDEN);
  }

  const otpKey = `patient-registration-otp:${email}`;
  const radisOtp = await radisClient.get(otpKey);
  console.log("radisOtp: ", radisOtp, "userOTP:", otp);
  if (!radisOtp) {
    throw new AppError("Invalid OTP", httpStatus.BAD_REQUEST);
  }

  if (radisOtp !== otp) {
    throw new AppError("OTP Does Not Match", httpStatus.BAD_REQUEST);
  }
  await radisClient.del(otpKey);

  const patientRegistrationKey = `patient-registration-data:${email}`;

  const radisPatientData = await radisClient.get(patientRegistrationKey);

  if (!radisPatientData) {
    throw new AppError("Patient does not exist", httpStatus.NOT_FOUND);
  }

  const patientPayload: IRegisterPatientPayload = JSON.parse(radisPatientData);

  const createdUser = await prisma.user.create({
    data: {
      name: patientPayload.name,
      email: patientPayload.email,
      password: patientPayload.password,
      role: Role.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      patient: {
        create: {
          name: patientPayload.name,
          email: patientPayload.email,
          contactNumber: patientPayload?.patient?.contactNumber,
        },
      },
    },
    omit: { password: true },
    include: { patient: true },
  });

  await radisClient.del(patientRegistrationKey);

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/patient-welcome-email.ejs",
  );

  const html = await ejs.renderFile(templatePath, {
    name: createdUser.name,
  
  });
  await transporter.sendMail({
    from: config.email_sender,
    to: email,
    subject: "Welcome To SH Healthcare System",
    html,
  });

  const { patient, ...user } = createdUser;
  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    user,
    patient,
    accessToken,
    refreshToken,
  };
};

const loginUser = async (payload: ILoginUserPayload) => {
  const { password } = payload;
  const email = payload.email.trim().toLowerCase();



  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new AppError("User not found", httpStatus.NOT_FOUND);
  }

  if (user.status === UserStatus.BLOCKED) {
    throw new AppError("User is blocked", httpStatus.FORBIDDEN);
  }

  if (user.isDeleted || user.status === UserStatus.DELETED) {
    throw new AppError("User is deleted", httpStatus.FORBIDDEN);
  }

  if (user.password === null || user.googleId !== null) {
    throw new AppError(
      "User already has account registered with Google, try to login with google",
      httpStatus.BAD_REQUEST,
    );
  }

  const isPasswordMatched = await bcrypt.compare(
    password,
    user.password as string,
  );

  if (!isPasswordMatched) {
    throw new AppError("Invalid credentials", httpStatus.UNAUTHORIZED);
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const getMe = async (user: IRequestUser) => {
  const isUserExists = await prisma.user.findUnique({
    where: {
      id: user.userId,
    },
    include: {
      patient: true,
    },
    omit: {
      password: true,
    },
  });

  if (!isUserExists) {
    throw new AppError("User not found", httpStatus.NOT_FOUND);
  }

  return isUserExists;
};

const refreshToken = async (token: string) => {
  const verifiedRefreshToken = jwtUtils.verifyToken(
    token,
    config.jwt_refresh_secret,
  );

  if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
    throw new AppError(
      config.node_env === "development"
        ? verifiedRefreshToken.error
        : "Invalid refresh token",
      httpStatus.UNAUTHORIZED,
    );
  }

  const data = verifiedRefreshToken.data as JwtPayload;

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
  });

  if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
    throw new AppError("User is inactive or not found", httpStatus.UNAUTHORIZED);
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const googleLogin = async (payload: IGoogleLoginPayload) => {
  let googleIdTokenPayload: TokenPayload | null | undefined = null;
  try {
    const ticket = await googleCLient.verifyIdToken({
      idToken: payload.idToken,
      audience: config.google_client_id,
    });

    googleIdTokenPayload = ticket.getPayload();
  } catch (error) {
    console.log("google id Token verfication failed", error);
    throw new AppError(
      "Invalid or expired Google ID token",
      httpStatus.UNAUTHORIZED,
    );
  }

  if (!googleIdTokenPayload) {
    throw new AppError(
      "Invalid or expired Google ID token",
      httpStatus.UNAUTHORIZED,
    );
  }
  if (!googleIdTokenPayload.email) {
    throw new AppError("Google email not found", httpStatus.BAD_REQUEST);
  }
  if (!googleIdTokenPayload.name) {
    throw new AppError("Google name not found", httpStatus.BAD_REQUEST);
  }

  const ifPatientExistsWithGoogleAuth = await prisma.user.findUnique({
    where: {
      email: googleIdTokenPayload.email,
      role: Role.PATIENT,
      googleId: googleIdTokenPayload.sub,
    },
  });
  let user = ifPatientExistsWithGoogleAuth;
  if (!ifPatientExistsWithGoogleAuth) {
    const ifPatientExistsWithCredentials = await prisma.user.findUnique({
      where: {
        email: googleIdTokenPayload.email,
        role: Role.PATIENT,
        authProvider: AuthProvider.CREDENTIAL,
      },
    });

    if (ifPatientExistsWithCredentials) {
      if (!ifPatientExistsWithCredentials.emailVerified) {
        throw new AppError("Email not verified", httpStatus.BAD_REQUEST);
      }
      if (ifPatientExistsWithCredentials.status === UserStatus.BLOCKED) {
        throw new AppError("User is Blocked", httpStatus.FORBIDDEN);
      }
      if (
        ifPatientExistsWithCredentials.isDeleted ||
        ifPatientExistsWithCredentials.status === UserStatus.DELETED
      ) {
        throw new AppError("User is Deleted", httpStatus.FORBIDDEN);
      }

      user = await prisma.user.update({
        where: {
          id: ifPatientExistsWithCredentials.id,
        },
        data: {
          googleId: googleIdTokenPayload.sub,
        },
      });
    } else {
      // google register
      user = await prisma.user.create({
        data: {
          name: googleIdTokenPayload.name,
          email: googleIdTokenPayload.email,
          role: Role.PATIENT,
          googleId: googleIdTokenPayload.sub,
          authProvider: AuthProvider.GOOGLE,
          emailVerified: true,
          patient: {
            create: {
              name: googleIdTokenPayload.name,
              email: googleIdTokenPayload.email,
            },
          },
        },
      });

      const templatePath = path.join(
        process.cwd(),
        "src/app/templates/patient-welcome-email.ejs",
      );

      const html = await ejs.renderFile(templatePath, {
        name: user.name,
      });
      await transporter.sendMail({
        from: config.email_sender,
        to: user.email,
        subject: "Welcome To SH Healthcare System",
        html,
      });
    }
  }
  if (!user) {
    throw new AppError("User not found", httpStatus.NOT_FOUND);
  }
  if (user.status === UserStatus.BLOCKED) {
    throw new AppError("User is Blocked", httpStatus.FORBIDDEN);
  }
  if (user.isDeleted || user.status === UserStatus.DELETED) {
    throw new AppError("User is Deleted", httpStatus.FORBIDDEN);
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
  const { email } = payload;

  const isUserExists = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!isUserExists) {
    throw new AppError("User does not exist", httpStatus.NOT_FOUND);
  }

  if (isUserExists.status === "BLOCKED") {
    throw new AppError("User is Blocked", httpStatus.FORBIDDEN);
  }
  if (!isUserExists.emailVerified) {
    throw new AppError("User not verified", httpStatus.BAD_REQUEST);
  }
  if (isUserExists.isDeleted || isUserExists.status === "DELETED") {
    throw new AppError("User is Deleted", httpStatus.FORBIDDEN);
  }
  if (isUserExists.googleId || isUserExists.authProvider === "GOOGLE") {
    throw new AppError("User has account with Google", httpStatus.BAD_REQUEST);
  }

  const otp = crypto.randomInt(100000, 1000000).toString();
  const key = `forgot-password-otp:${isUserExists.email}`;
  const expirationSeconds = 5 * 60;
  await radisClient.set(key, otp, {
    expiration: {
      type: "EX",
      value: expirationSeconds,
    },
  });
  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/forgot-password.ejs",
  );

  const html = await ejs.renderFile(templatePath, {
    name: isUserExists.name,
    OTP: otp,
    expirationMinutes: expirationSeconds / 60,
  });
  await transporter.sendMail({
    from: config.email_sender,
    to: isUserExists.email,
    subject: "Forgot Password",
    html,
  });
};

const resetPassword = async (payload: IResetPasswordPayload) => {
  const { email, otp, newPassword } = payload;

  const isUserExists = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!isUserExists) {
    throw new AppError("User does not exist", httpStatus.NOT_FOUND);
  }

  if (isUserExists.status === "BLOCKED") {
    throw new AppError("User is Blocked", httpStatus.FORBIDDEN);
  }
  if (!isUserExists.emailVerified) {
    throw new AppError("User not verified", httpStatus.BAD_REQUEST);
  }
  if (isUserExists.isDeleted || isUserExists.status === "DELETED") {
    throw new AppError("User is Deleted", httpStatus.FORBIDDEN);
  }
  if (isUserExists.googleId || isUserExists.authProvider === "GOOGLE") {
    throw new AppError("User has account with Google", httpStatus.BAD_REQUEST);
  }
  const key = `forgot-password-otp:${isUserExists.email}`;
  const radisOtp = await radisClient.get(key);
  console.log("radisOtp: ", radisOtp, "userOTP:", otp);
  if (!radisOtp) {
    throw new AppError("Invalid OTP", httpStatus.BAD_REQUEST);
  }

  if (radisOtp !== otp) {
    throw new AppError("OTP Does Not Match", httpStatus.BAD_REQUEST);
  }

  const hashedNewPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  await prisma.user.update({
    where: {
      email: isUserExists.email,
    },
    data: {
      password: hashedNewPassword,
    },
  });

  await radisClient.del([key]);

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/password-changed.ejs",
  );

  const html = await ejs.renderFile(templatePath, {
    name: isUserExists.name,
    OTP: otp,
  });

  await transporter.sendMail({
    from: config.email_sender,
    to: isUserExists.email,
    subject: "Password Changed",
    html,
  });
};

export const AuthService = {
  registerPatient,
  verifyPatientEmail,
  loginUser,
  getMe,
  refreshToken,
  googleLogin,
  forgotPassword,
  resetPassword,
};
