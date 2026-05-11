const express = require("express");
const adminFinanceController = require("../controllers/adminFinance.controller");

const router = express.Router();

router.get("/finance", adminFinanceController.requireAdmin, adminFinanceController.renderFinancePage);
router.get(
  "/finance/reports/preview",
  adminFinanceController.requireAdmin,
  adminFinanceController.renderFinanceReportPreview
);
router.get(
  "/finance/reports/pdf",
  adminFinanceController.requireAdmin,
  adminFinanceController.renderFinanceReportPdf
);
router.get(
  "/finance/reports/csv",
  adminFinanceController.requireAdmin,
  adminFinanceController.exportFinanceCsv
);
router.post("/finance/settings", adminFinanceController.requireAdmin, adminFinanceController.updateFinanceSettings);
router.post(
  "/finance/competence/reset",
  adminFinanceController.requireAdmin,
  adminFinanceController.resetFinanceCompetence
);
router.post("/finance/players/:id", adminFinanceController.requireAdmin, adminFinanceController.updateFinancePlayer);
router.post(
  "/finance/monthly/ensure",
  adminFinanceController.requireAdmin,
  adminFinanceController.handleEnsureMonthlyCompetence
);
router.post(
  "/finance/monthly-fees/generate",
  adminFinanceController.requireAdmin,
  adminFinanceController.handleEnsureMonthlyCompetence
);
router.post(
  "/finance/monthly-fees/:id/update",
  adminFinanceController.requireAdmin,
  adminFinanceController.updateMonthlyFee
);
router.post(
  "/finance/monthly-fees/:id/recalculate",
  adminFinanceController.requireAdmin,
  adminFinanceController.recalculateMonthlyFee
);
router.post(
  "/finance/monthly-fees/:id/pay",
  adminFinanceController.requireAdmin,
  adminFinanceController.payMonthlyFee
);
router.post(
  "/finance/monthly-fees/bulk-status",
  adminFinanceController.requireAdmin,
  adminFinanceController.handleBulkMonthlyStatus
);
router.post("/finance/charge/bulk", adminFinanceController.requireAdmin, adminFinanceController.handleBulkCharge);
router.post(
  "/finance/monthly-fees/:id/delete",
  adminFinanceController.requireAdmin,
  adminFinanceController.deleteMonthlyFee
);
router.post(
  "/finance/monthly-fees/:id/exempt",
  adminFinanceController.requireAdmin,
  adminFinanceController.exemptMonthlyFee
);
router.post(
  "/finance/cash-transactions",
  adminFinanceController.requireAdmin,
  adminFinanceController.createCashTransaction
);
router.post(
  "/finance/cash-transactions/:id/update",
  adminFinanceController.requireAdmin,
  adminFinanceController.updateCashTransaction
);
router.post(
  "/finance/cash-transactions/:id/delete",
  adminFinanceController.requireAdmin,
  adminFinanceController.deleteCashTransaction
);
router.post(
  "/finance/guest-payments",
  adminFinanceController.requireAdmin,
  adminFinanceController.createGuestPayment
);
router.post(
  "/finance/guest-payments/:id/update",
  adminFinanceController.requireAdmin,
  adminFinanceController.updateGuestPayment
);
router.post(
  "/finance/guest-payments/:id/delete",
  adminFinanceController.requireAdmin,
  adminFinanceController.deleteGuestPayment
);

module.exports = router;
