import { Role } from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";
import bycript from "bcryptjs";
import { AppError } from "../utils/appError";
import httpStatus from "http-status";

// super admin create
export const seedSuperAdmin = async () => {
  try {
    const isSuperAdmin = await prisma.user.findFirst({
      where: {
        role: Role.SUPER_ADMIN,
      },
    });

    if (isSuperAdmin) {
      console.log("Super admin already exists");
      return;
    }
    const name = config.super_admin_name;
    const email = config.super_admin_email;
    const password = config.super_admin_password;

    if (!name || !email || !password) {
      throw new AppError(
        "Super admin Name email password missing in .env file",
        httpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const hashedPassword = await bycript.hash(
      password,
      Number(config.bcrypt_salt_rounds),
    );

    const superAdmin = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: Role.SUPER_ADMIN,
        needPasswordChange: false,
        emailVerified: true,
      },
    });

    console.log("Super admin created !!!!", superAdmin);
  } catch (error) {
    console.log("Error seeding super admin", error);
    await prisma.user.delete({
      where: {
        email: config.super_admin_email,
      },
    });
  }
};

// tester admin create
export const seedTesterAdmin = async () => {
  try {
    const isTesterAdmin = await prisma.user.findUnique({
      where: {
        email: config.tester_admin_email,
      },
    });
    if (isTesterAdmin) {
      console.log("Tester Admin alredy exists");
      return;
    }

    const name = config.tester_admin_name;
    const email = config.tester_admin_email;
    const password = config.tester_admin_password;

    if (!name || !email || !password) {
      throw new AppError(
        "Tester admin Name email password missing in .env file",
        httpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const hashedPassword = await bycript.hash(
      password,
      Number(config.bcrypt_salt_rounds),
    );

    const testerAdmin = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: Role.ADMIN,
        needPasswordChange: false,
        emailVerified: true,
      },
    });
  } catch (error) {
    console.log("Error seeding Tester admin", error);
    await prisma.user.delete({
      where: {
        email: config.tester_admin_email,
      },
    });
  }
};

//  tester doctor create
export const seedTesterDoctor = async () => {
  try {
    const isTesterDoctor = await prisma.user.findFirst({
      where: {
        role: Role.DOCTOR,
      },
    });
    if (isTesterDoctor) {
      console.log("Tester Doctor alredy exists");
      return;
    }

    const name = config.tester_doctor_name;
    const email = config.tester_doctor_email;
    const password = config.tester_doctor_password;

    if (!name || !email || !password) {
      throw new AppError(
        "Tester Doctor Name, email, password missing in .env file",
        httpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const hashedPassword = await bycript.hash(
      password,
      Number(config.bcrypt_salt_rounds),
    );

    const testerDoctor = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: Role.DOCTOR,
        needPasswordChange: false,
        emailVerified: true,
        doctor: {
          create: {
            email,
            name,
            experienceYears: 5,
            licenseNumber: "DNC00002",
            qualifications: "MBBS",
            specialization: "Neurology",
            contactNumber:"01744444444"
          },
        },
      },
    });
  } catch (error) {
    console.log("Error seeding Doctor", error);
    await prisma.user.delete({
      where: {
        email: config.tester_doctor_email,
      },
    });
  }
};
