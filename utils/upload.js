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
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg"]);
    const allowedMimes = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"]);
    if (!allowedExts.has(ext) || !allowedMimes.has(file.mimetype)) {
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

// Redimensiona e comprime a imagem salva pelo multer.
// Retorna o novo filename (basename) após o processamento.
async function processUploadedImage(filePath, type) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    return path.basename(filePath);
  }

  const dims =
    type === "weekly"
      ? { width: 1280, height: 720, quality: 85 }
      : { width: 600, height: 600, quality: 82 };

  const ext = path.extname(filePath).toLowerCase();
  const baseNoExt = filePath.slice(0, filePath.length - path.extname(filePath).length);
  const outPath = ext === ".jpg" || ext === ".jpeg" ? filePath : baseNoExt + ".jpg";
  const tmpPath = outPath + ".tmp";

  await sharp(filePath)
    .resize(dims.width, dims.height, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: dims.quality })
    .toFile(tmpPath);

  fs.renameSync(tmpPath, outPath);
  if (outPath !== filePath) {
    try { fs.unlinkSync(filePath); } catch {}
  }

  return path.basename(outPath);
}

module.exports = {
  uploadPlayerPhoto,
  uploadWeeklyTeamPhoto,
  processUploadedImage,
};
