import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import {
  AppointmentStatus,
  PaymentStatus,
} from "../../../generated/prisma/enums";
import { RequestUser } from "../../middleware/checkAuth";
import { th } from "zod/locales";
import { AppError } from "../../utils/appError";
import httpStatus from "http-status";

const bookAppointment = async (payload: any, user: RequestUser) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    // 1. Create appointment only once when booking starts
    const appointment = await tx.appointment.create({
      data: {
        status: AppointmentStatus.PENDING,
      },
    });

    const bkashIdToken = await getBkashIdToken();

    if (!bkashIdToken) {
      throw new AppError(
        "No bKash access token found",
        httpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // 2. Create bKash payment
    const bkashCreatePaymentResponse = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/create`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: bkashIdToken,
          "X-App-Key": config.bkash_app_key,
        },
        body: JSON.stringify({
          agreementID: "TokenizedMerchant01L3IKB6H1565072174986",
          mode: "0011",
          payerReference: user.email,
          callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
          merchantAssociationInfo: "MI05MID54RF09123456One",
          amount: "1200",
          currency: "BDT",
          intent: "sale",
          merchantInvoiceNumber: appointment.id,
        }),
      },
    );

    const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

    if (
      !bkashCreatePaymentResponse.ok ||
      !bkashCreatePaymentResult.paymentID ||
      !bkashCreatePaymentResult.bkashURL
    ) {
      throw new AppError(
        bkashCreatePaymentResult.statusMessage ||
          "Failed to create bKash payment",
        httpStatus.BAD_GATEWAY,
      );
    }

    // 3. Create payment record for this appointment
    await tx.payment.create({
      data: {
        merchantInvoiceNumber: appointment.id,
        appointmentID: appointment.id,
        amount: "1200",
        gatewayResponse: bkashCreatePaymentResult,
        bkashPaymentId: bkashCreatePaymentResult.paymentID,
        payerReference: user.email,
      },
    });

    return {
      paymentUrl: bkashCreatePaymentResult.bkashURL,
    };
  });

  return transactionResult;
};

const payAppointment = async (payload: any, user: RequestUser) => {
  const appointmentId = payload.appointmentId;

  const existingAppointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },
  });

  if (!existingAppointment) {
    throw new AppError("Appointment does not exist", httpStatus.NOT_FOUND);
  }

  if (existingAppointment.status !== "PENDING") {
    throw new AppError("Appointment is not pending", httpStatus.BAD_REQUEST);
  }

  // if(existingAppointment.status === "CANCELLED" || existingAppointment.status === "ONGOING" || existingAppointment.status === "COMPLETED" ||){
  //   throw new Error(`Appointment is already ${AppointmentStatus}`)
  // }

  const bkashIdToken = await getBkashIdToken();

  if (!bkashIdToken) {
    throw new AppError("No bKash access token found", httpStatus.SERVICE_UNAVAILABLE);
  }

  // 2. Create bKash payment
  const bkashCreatePaymentResponse = await fetch(
    `${config.bkash_base_url}/tokenized/checkout/create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: bkashIdToken,
        "X-App-Key": config.bkash_app_key,
      },
      body: JSON.stringify({
        agreementID: "TokenizedMerchant01L3IKB6H1565072174986",
        mode: "0011",
        payerReference: user.email,
        callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
        merchantAssociationInfo: "MI05MID54RF09123456One",
        amount: "1200",
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: existingAppointment.id,
      }),
    },
  );

  const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

  await prisma.payment.update({
    where: {
      appointmentID: existingAppointment.id,
    },
    data: {
      merchantInvoiceNumber: existingAppointment.id,

      gatewayResponse: bkashCreatePaymentResult,
      bkashPaymentId: bkashCreatePaymentResult.paymentID,
      payerReference: user.email,
    },
  });

  return {
    paymentUrl: bkashCreatePaymentResult.bkashURL,
  };
};

const bookAppointmentCallBack = async (query: Record<string, any>) => {
  const paymentID = query.paymentID;
  const status = query.status;

  if (!paymentID) {
    throw new AppError("Payment ID is missing", httpStatus.BAD_REQUEST);
  }

  if (!status) {
    throw new AppError("Payment status is missing", httpStatus.BAD_REQUEST);
  }

  const transactionResult = await prisma.$transaction(async (tx) => {
    // 1. Find the EXISTING payment record
    const payment = await tx.payment.findUnique({
      where: {
        bkashPaymentId: paymentID,
      },
    });

    if (!payment) {
      throw new AppError("Payment record not found", httpStatus.NOT_FOUND);
    }

    const successURL = `${config.frontend_url}/dashboard/my-appointments?status=success`;
    const failureURL = `${config.frontend_url}/dashboard/my-appointments?status=failure`;
    const cancelURL = `${config.frontend_url}/dashboard/my-appointments?status=cancel`;

    // 2. Prevent duplicate processing if already paid
    if (payment.status === PaymentStatus.PAID) {
      return {
        redirectURL: successURL,
      };
    }

    // 3. Handle cancellation
    if (status === "cancel") {
      await tx.payment.update({
        where: {
          bkashPaymentId: paymentID,
        },
        data: {
          status: PaymentStatus.CANCELLED,
        },
      });

      return {
        redirectURL: cancelURL,
      };
    }

    // 4. Handle failure
    if (status === "failure") {
      await tx.payment.update({
        where: {
          bkashPaymentId: paymentID,
        },
        data: {
          status: PaymentStatus.FAILED,
        },
      });

      return {
        redirectURL: failureURL,
      };
    }

    if (status !== "success") {
      return {
        redirectURL: `${config.frontend_url}/dashboard/my-appointments?error=payment-failed`,
      };
    }

    // 5. Verify payment with bKash
    const bkashIdToken = await getBkashIdToken();

    if (!bkashIdToken) {
      throw new AppError("bKash access token is missing", httpStatus.SERVICE_UNAVAILABLE);
    }

    const executedPaymentResponse = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: bkashIdToken,
          "X-App-Key": config.bkash_app_key,
        },
        body: JSON.stringify({
          paymentID,
        }),
      },
    );

    const executedPaymentResult = await executedPaymentResponse.json();

    // 6. Confirm only after bKash verifies successful payment
    if (
      !executedPaymentResponse.ok ||
      executedPaymentResult.statusCode !== "0000" ||
      executedPaymentResult.transactionStatus !== "Completed"
    ) {
      await tx.payment.update({
        where: {
          bkashPaymentId: paymentID,
        },
        data: {
          status: PaymentStatus.FAILED,
          gatewayResponse: executedPaymentResult,
        },
      });

      return {
        redirectURL: failureURL,
      };
    }

    // 7. Update the EXISTING appointment using its saved ID
    await tx.appointment.update({
      where: {
        id: payment.appointmentID,
      },
      data: {
        status: AppointmentStatus.CONFIRMED,
      },
    });

    // 8. Update the EXISTING payment record
    await tx.payment.update({
      where: {
        bkashPaymentId: paymentID,
      },
      data: {
        status: PaymentStatus.PAID,
        bkashTrxId: executedPaymentResult.trxID,
        paidAt: executedPaymentResult.paymentExecuteTime
          ? String(executedPaymentResult.paymentExecuteTime)
          : new Date().toISOString(),
        gatewayResponse: executedPaymentResult,
      },
    });

    return {
      redirectURL: successURL,
    };
  });

  return transactionResult;
};

const cancelAppointment = async (payload: any) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    const appointmentId = payload.appointmentId;

    const existingAppointment = await tx.appointment.findUnique({
      where: {
        id: appointmentId,
      },
      include: {
        payment: true,
      },
    });

    if (!existingAppointment) {
      throw new AppError("Appointment does not exist", httpStatus.NOT_FOUND);
    }

    if (
      existingAppointment.status === "ONGOING" ||
      existingAppointment.status === "COMPLETED"
    ) {
      throw new AppError(
        "Appointment ongoing or completed",
        httpStatus.BAD_REQUEST,
      );
    }
    if (existingAppointment.status === "CANCELLED") {
      throw new AppError("Appointment already cancelled", httpStatus.BAD_REQUEST);
    }

    const updatedAppointment = await tx.appointment.update({
      where: {
        id: existingAppointment.id,
      },
      data: {
        status: AppointmentStatus.CANCELLED,
      },
    });

    const bkashIdToken = await getBkashIdToken();

    if (!bkashIdToken) {
      throw new AppError(
        "No bKash access token found",
        httpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const bkashRefundPaymentResponse = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/payment/refund`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: bkashIdToken,
          "X-App-Key": config.bkash_app_key,
        },
        body: JSON.stringify({
          paymentID: existingAppointment.payment?.bkashPaymentId,
          trxID: existingAppointment.payment?.bkashTrxId,
          amount: existingAppointment.payment?.amount.toString(),
          sku: "Appointment Cancellation",
          reason: "Patient Cancelled the Appointment",
        }),
      },
    );

    const bkashRefundPaymentResult = await bkashRefundPaymentResponse.json();

    console.log(bkashRefundPaymentResult);

    const updatedPayment = await tx.payment.update({
      where: {
        appointmentID: existingAppointment.id,
      },
      data: {
        refundTrxId: bkashRefundPaymentResult.refundTrxID,
        refundedAt: bkashRefundPaymentResult.completedTime,
        refundAmount: bkashRefundPaymentResult.amount,
        refundReason: "Patient Cancelled the Appointment",
        status: PaymentStatus.REFUNDED,
        gatewayResponse: bkashRefundPaymentResult,
      },
    });

    return {
      appontment: updatedAppointment,
      payment: updatedPayment,
    };
  });

  return transactionResult;
};
export const AppointmentServices = {
  bookAppointment,
  bookAppointmentCallBack,
  payAppointment,
  cancelAppointment,
};
