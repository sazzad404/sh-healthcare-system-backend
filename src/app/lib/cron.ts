import cron from "node-cron";
import { prisma } from "./prisma";
import { doctorVerificationStatus, Role } from "../../generated/prisma/enums";

export const deleteUnverifiedDoctorApplications = async () => {
  // prisma bussiness logic => delete doctor application after 10 minutes of creation if not approved
  try {
    cron.schedule("*/10 * * * *", async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); //  1 hour ago

      const deletedDoctors = await prisma.user.deleteMany({
        where: {
          role: Role.DOCTOR,
          emailVerified: false,
          createdAt: { lt: oneHourAgo },
          doctor: {
            verificationStatus: doctorVerificationStatus.PENDING,
          },
        },
      });

      if (deletedDoctors.count > 0) {
        console.log(
          ` Cron: Deleted ${deletedDoctors.count} unverified email doctor applications.`,
        );
      }
    });
  } catch (error) {
    console.error(
      "Cron: Failed deleting unverified doctor applications:",
      error,
    );
  }

  console.log("Doctor Delete cron schedule every 10 minutes");
};
