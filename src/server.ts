import app from "./app";
import config from "./app/config";
import { deleteUnverifiedDoctorApplications } from "./app/lib/cron";
import { transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { radisClient } from "./app/lib/radis";

import {
  seedSuperAdmin,
  seedTesterAdmin,
  seedTesterDoctor,
} from "./app/utils/seed";

const PORT = config.port;

const main = async () => {
  try {
    await prisma.$connect();
    console.log("Connected to the database successfully.");
    await radisClient.connect();
    console.log("Radis Connected Successfully");

    await transporter.verify();
    console.log("Nodemailer Connected Successfully");

    await seedSuperAdmin();
    await seedTesterAdmin();
    await seedTesterDoctor();

    await deleteUnverifiedDoctorApplications();

  
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error starting the server:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

main();
