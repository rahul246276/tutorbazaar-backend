const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Storage for tutor profile images
const profileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'tutorbazaar/profiles',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }],
  },
});

// Storage for verification documents
const documentStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'tutorbazaar/documents',
    allowed_formats: ['pdf', 'jpg', 'jpeg', 'png'],
  },
});

const uploadProfile = multer({ storage: profileStorage });
const uploadDocument = multer({ storage: documentStorage });

module.exports = {
  cloudinary,
  uploadProfile,
  uploadDocument,
};
