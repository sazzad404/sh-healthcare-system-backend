import { doctorVerificationStatus } from "../../../generated/prisma/enums";

export interface IVerifiedDoctorEmailPayload {
  email: string;
  otp: string;
}

export interface IApplyAsDoctor {
  user: {
    name: string;
    email: string;
  };
  doctor: {
    adress?: string;
    specialization: string;
    licenseNumber: string;
    qualifications: string;
    experienceYears: number;
    bio?: string;
    consultationFee?: number;
    contactNumber?: string;
  };
}

export interface IApproveDoctor {
  doctorId: string;
  verificationStatus: doctorVerificationStatus;
  rejectionReason: string;
}
