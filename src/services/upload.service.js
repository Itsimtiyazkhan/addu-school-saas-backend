const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Try to use Cloudinary if configured
let cloudinary = null;
try {
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud') {
    cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log('☁️  Cloudinary configured');
  }
} catch (e) {
  console.log('📁 Using local file storage (Cloudinary not configured)');
}

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads');
['photos', 'documents', 'temp'].forEach(sub => {
  fs.mkdirSync(path.join(uploadDir, sub), { recursive: true });
});

// Multer storage - temp disk first, then upload to Cloudinary
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(uploadDir, 'temp')),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.test(ext)) cb(null, true);
  else cb(new Error('File type not allowed'), false);
};

// Export configured multer instances
const uploadPhoto = multer({
  storage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
}).single('photo');

const uploadDocument = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('document');

const uploadMultiple = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).array('files', 5);

// ─── Upload to Cloudinary or save locally ─────────────────────────────────────
const processUpload = async (file, folder = 'general') => {
  if (!file) return null;

  if (cloudinary) {
    try {
      const result = await cloudinary.uploader.upload(file.path, {
        folder: `akkhor/${folder}`,
        transformation: folder === 'photos' ? [
          { width: 300, height: 300, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' },
        ] : undefined,
      });
      // Delete temp file
      fs.unlink(file.path, () => {});
      return {
        url: result.secure_url,
        publicId: result.public_id,
        provider: 'cloudinary',
      };
    } catch (err) {
      console.error('Cloudinary upload error:', err.message);
    }
  }

  // Fallback: move from temp to proper folder
  const destDir = path.join(uploadDir, folder);
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, path.basename(file.path));
  fs.renameSync(file.path, destPath);

  const relativePath = `/${process.env.UPLOAD_DIR || 'uploads'}/${folder}/${path.basename(destPath)}`;
  return {
    url: `${process.env.APP_URL || 'http://localhost:5000'}${relativePath}`,
    publicId: path.basename(destPath),
    provider: 'local',
  };
};

// ─── Delete from Cloudinary or local ──────────────────────────────────────────
const deleteFile = async (publicId, provider = 'cloudinary') => {
  try {
    if (provider === 'cloudinary' && cloudinary) {
      await cloudinary.uploader.destroy(publicId);
    } else {
      const localPath = path.join(uploadDir, publicId);
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    }
  } catch (err) {
    console.error('Delete file error:', err.message);
  }
};

// ─── Multer error handler middleware ─────────────────────────────────────────
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large (max 5MB)' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) return res.status(400).json({ success: false, message: err.message });
  next();
};

module.exports = { uploadPhoto, uploadDocument, uploadMultiple, processUpload, deleteFile, handleUploadError };
