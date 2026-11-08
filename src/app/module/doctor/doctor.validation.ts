import { z } from "zod";

export const applyAsDoctorValidationZodSchema = z.object({
  user: z.object({
    name: z.string().min(1, "Name is required"),
    email: z.email("Invalid email address"),
  }),

  doctor: z.object({
    address: z.string().optional(),

    specialization: z.string().min(1, "Specialization is required"),

    licenseNumber: z.string().min(1, "License number is required"),

    qualifications: z.string().min(1, "Qualifications are required"),

    experienceYears: z.coerce
      .number()
      .int()
      .min(0, "Experience years cannot be negative"),

    bio: z.string().optional(),

    consultationFee: z.coerce
      .number()
      .positive("Consultation fee must be positive")
      .optional(),

    contactNumber: z.string().optional(),
  }),
});
