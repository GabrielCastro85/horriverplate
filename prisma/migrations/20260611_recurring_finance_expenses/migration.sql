-- Add automatic recurring expenses for finance cash flow.
ALTER TYPE "FinanceTransactionOrigin" ADD VALUE IF NOT EXISTS 'RECURRING_EXPENSE';

CREATE TABLE "RecurringExpense" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(10, 2) NOT NULL,
  "category" "FinanceTransactionCategory" NOT NULL DEFAULT 'COURT',
  "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "startMonth" INTEGER NOT NULL,
  "startYear" INTEGER NOT NULL,
  "endMonth" INTEGER,
  "endYear" INTEGER,
  "description" TEXT,
  "note" TEXT,
  "createdByAdminId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringExpenseRun" (
  "id" SERIAL NOT NULL,
  "recurringExpenseId" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "cashTransactionId" INTEGER NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecurringExpenseRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecurringExpense_isActive_startYear_startMonth_idx"
  ON "RecurringExpense"("isActive", "startYear", "startMonth");

CREATE INDEX "RecurringExpense_category_idx"
  ON "RecurringExpense"("category");

CREATE INDEX "RecurringExpense_createdByAdminId_idx"
  ON "RecurringExpense"("createdByAdminId");

CREATE UNIQUE INDEX "RecurringExpenseRun_cashTransactionId_key"
  ON "RecurringExpenseRun"("cashTransactionId");

CREATE INDEX "RecurringExpenseRun_year_month_idx"
  ON "RecurringExpenseRun"("year", "month");

CREATE UNIQUE INDEX "RecurringExpenseRun_recurringExpenseId_month_year_key"
  ON "RecurringExpenseRun"("recurringExpenseId", "month", "year");

ALTER TABLE "RecurringExpense"
  ADD CONSTRAINT "RecurringExpense_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecurringExpenseRun"
  ADD CONSTRAINT "RecurringExpenseRun_recurringExpenseId_fkey"
  FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecurringExpenseRun"
  ADD CONSTRAINT "RecurringExpenseRun_cashTransactionId_fkey"
  FOREIGN KEY ("cashTransactionId") REFERENCES "CashTransaction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
