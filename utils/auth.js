const jwt = require("jsonwebtoken");



if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production.");
}
const SECRET_KEY = process.env.JWT_SECRET || "dev-secret";

/**
 * Gera um token JWT para o admin.
 * @param {object} payload - Dados que vão dentro do token (ex: { id, email }).
 * @param {object} options - Opções extras do JWT (ex: expiresIn).
 * @returns {string} token
 */
function generateToken(payload, options = {}) {
  const defaultOptions = { expiresIn: "2h" };

  return jwt.sign(payload, SECRET_KEY, {
    ...defaultOptions,
    ...options,
  });
}

/**
 * Valida um token JWT.
 * @param {string} token
 * @returns {object|null} payload decodado ou null se inválido/expirado
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET_KEY);
  } catch (err) {
    return null;
  }
}


module.exports = {
  generateToken,
  verifyToken,
};
