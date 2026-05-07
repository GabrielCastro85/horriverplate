const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../../utils/db");
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect("/login");
  next();
}

// ==============================
// Trocar senha do admin logado
// ==============================
router.get("/senha", requireAdmin, (req, res) => {
  res.render("admin_password", {
    title: "Trocar senha",
    error: null,
    success: req.query.success === "1",
  });
});

router.post("/senha", requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.render("admin_password", {
        title: "Trocar senha",
        error: "Preencha todos os campos.",
        success: false,
      });
    }

    if (newPassword.length < 6) {
      return res.render("admin_password", {
        title: "Trocar senha",
        error: "A nova senha deve ter pelo menos 6 caracteres.",
        success: false,
      });
    }

    if (newPassword !== confirmPassword) {
      return res.render("admin_password", {
        title: "Trocar senha",
        error: "A confirmação da senha não confere.",
        success: false,
      });
    }

    const admin = await prisma.admin.findUnique({ where: { id: req.admin.id } });
    if (!admin) {
      return res.redirect("/login");
    }

    const ok = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!ok) {
      return res.render("admin_password", {
        title: "Trocar senha",
        error: "Senha atual incorreta.",
        success: false,
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.admin.update({
      where: { id: admin.id },
      data: { passwordHash },
    });

    return res.redirect("/admin/senha?success=1");
  } catch (err) {
    console.error("Erro ao trocar senha:", err);
    return res.render("admin_password", {
      title: "Trocar senha",
      error: "Erro ao tentar trocar a senha. Tente novamente.",
      success: false,
    });
  }
});

// ==============================
// Auditoria (apenas admin principal)
// ==============================
router.get("/auditoria", requireAdmin, async (req, res) => {
  try {
    if (!req.admin || req.admin.email !== "admin@horriver.com") {
      return res.redirect("/admin");
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = 50;
    const skip = (page - 1) * pageSize;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.auditLog.count(),
    ]);

    const totalPages = Math.max(Math.ceil(total / pageSize), 1);

    return res.render("admin_audit", {
      title: "Auditoria",
      logs,
      page,
      totalPages,
      total,
    });
  } catch (err) {
    console.error("Erro ao carregar auditoria:", err);
    return res.redirect("/admin");
  }
});

module.exports = router;
