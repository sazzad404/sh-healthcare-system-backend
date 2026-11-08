import z, { email } from "zod";

const PatientRegisterationZodSchema = z.object({
  name: z
    .string("Not a string")
    .min(3, "Name must be atleast 3 characters long")
    .max(30, "Name must be hight 10 characters long"),
  email: z.email(),
  password: z
    .string()
    .min(8, "Password Must Minium 8 Characters Long")
    .max(32)
    .regex(/[A-Z]/, "Password must contain atleast 1 Uppercase")
    .regex(/[a-z]/, "Password must contain atleast 1 Lowercase")
    .regex(/[0-9]/, "Password must contain atleast 1 Number")
    .regex(
      /[!@#$%^&*(),.?":{}|<>]/,
      "Password must contain atleast 1 Special Characters",
    ),
  patient: z
    .object({
      contactNumber: z.string().optional(),
    })
    .optional(),
});
const PatientEmailVerifyZodSchema = z.object({
  email: z.email(),
  otp: z.string().length(6),
});

const PatientLoginZodSchema = z.object({
  email: z.email(),
  password: z
    .string()
    .min(8, "Password Must Minium 8 Characters Long")
    .max(32)
    .regex(/[A-Z]/, "Password must contain atleast 1 Uppercase")
    .regex(/[a-z]/, "Password must contain atleast 1 Lowercase")
    .regex(/[0-9]/, "Password must contain atleast 1 Number")
    .regex(
      /[!@#$%^&*(),.?":{}|<>]/,
      "Password must contain atleast 1 Special Characters",
    ),
});

const ForgotPasswordZodSchema = z.object({
  email: z.email(),
});

const ResetPasswordZodSchema = z.object({
  email: z.email(),
  newPassword: z
    .string()
    .min(8, "Password Must Minium 8 Characters Long")
    .max(32)
    .regex(/[A-Z]/, "Password must contain atleast 1 Uppercase")
    .regex(/[a-z]/, "Password must contain atleast 1 Lowercase")
    .regex(/[0-9]/, "Password must contain atleast 1 Number")
    .regex(
      /[!@#$%^&*(),.?":{}|<>]/,
      "Password must contain atleast 1 Special Characters",
    ),
  otp: z.string().length(6),
});

export const userValidation = {
  PatientRegisterationZodSchema,
  PatientLoginZodSchema,
  ForgotPasswordZodSchema,
  ResetPasswordZodSchema,
  PatientEmailVerifyZodSchema,
};
