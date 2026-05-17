const Razorpay = require('razorpay');
const logger = require('../utils/logger');

let razorpay = null;

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  logger.warn('⚠️  Razorpay keys not configured — payment features will not work');
} else {
  try {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  } catch (error) {
    logger.error('Failed to initialize Razorpay:', error.message);
  }
}

module.exports = razorpay;
