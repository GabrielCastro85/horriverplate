const multer = require("multer");
const path = require("path");
const fs = require("fs");

function createUpload(subfolder) {
  const uploadDir = path.join(__dirname, "..", "public", "uploads", subfolder);

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, uniqueSuffix + ext);
    },
  });

  function fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Apenas arquivos de imagem são permitidos."), false);
    }
    cb(null, true);
  }

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  });
}

// Upload de foto de jogador (quando cadastra o player)
const uploadPlayerPhoto = createUpload("players");

// Upload de foto do time da semana
const uploadWeeklyTeamPhoto = createUpload("weekly");

module.exports = {
  uploadPlayerPhoto,
  uploadWeeklyTeamPhoto,
};
