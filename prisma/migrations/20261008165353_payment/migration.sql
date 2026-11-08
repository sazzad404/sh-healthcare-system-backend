/*
  Warnings:

  - You are about to drop the column `bkashTexId` on the `payments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "payments" DROP COLUMN "bkashTexId",
ADD COLUMN     "bkashTrxId" TEXT;
