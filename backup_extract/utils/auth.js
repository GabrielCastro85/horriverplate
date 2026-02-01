const jwt = require("jsonwebtoken");



const SECRET_KEY = process.env.JWT_SECRET || "dev-secret";

/**
 * Gera um token JWT para o admin.
 * @param {object} payload - Dados que vÃ£o dentro do token (ex: { id, email }).
 * @param {object} options - OpÃ§Ãµes extras do JWT (ex: expiresIn).
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
 * @returns {object|null} payload decodado ou null se invÃ¡lido/expirado
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
