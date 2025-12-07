const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const bcrypt = require("bcryptjs");
const { generateToken } = require("../utils/auth");

// ===============================
// GET /login  → tela de login
// ===============================
router.get("/login", (req, res) => {
  // Se já estiver logado, manda direto pro painel admin
  if (req.admin) {
    return res.redirect("/admin");
  }

  res.render("login", {
    title: "Login",
    error: null,
  });
});

// ===============================
// POST /login  → autenticação
// ===============================
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.render("login", {
        title: "Login",
        error: "Informe e-mail e senha.",
      });
    }

    // Procura o admin pelo e-mail
    const admin = await prisma.admin.findUnique({
      where: { email },
    });

    if (!admin) {
      return res.render("login", {
        title: "Login",
        error: "E-mail ou senha incorretos.",
      });
    }

    // Compara a senha digitada com o hash salvo
    const senhaOk = await bcrypt.compare(password, admin.passwordHash);

    if (!senhaOk) {
      return res.render("login", {
        title: "Login",
        error: "E-mail ou senha incorretos.",
      });
    }

    // Gera token JWT usando util do projeto
    const token = generateToken({
      id: admin.id,
      email: admin.email,
    });

    // Salva o token em cookie httpOnly
    res.cookie("adminToken", token, {
      httpOnly: true,
      secure: false, // colocar true se usar HTTPS
      sameSite: "lax",
      maxAge: 2 * 60 * 60 * 1000, // 2 horas
    });

    return res.redirect("/admin");
  } catch (err) {
    console.error("Erro no login:", err);
    return res.render("login", {
      title: "Login",
      error: "Erro ao tentar fazer login. Tente novamente.",
    });
  }
});

// ===============================
// POST /logout  → sair do painel
// ===============================
router.post("/logout", (req, res) => {
  res.clearCookie("adminToken");
  return res.redirect("/");
});

module.exports = router;
