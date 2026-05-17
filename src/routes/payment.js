/**
 * Payment routes
 *
 * BUGS FIXED:
 * - Removed duplicate /tutors/plans/* routes that were mounted at the wrong
 *   path prefix (/api/payments/tutors/...) — these are already defined in
 *   tutor.js at the correct /api/tutors/plans/* paths.
 */

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Payment = require('../models/Payment');
const { handlePaymentWebhook, getAllPlans } = require('../controllers/planController');

// Public: list plans
router.get('/plans', getAllPlans);

// Razorpay webhook — express.raw() applied in server.js BEFORE express.json()
router.post('/webhook', handlePaymentWebhook);

// Payment history for logged-in user
router.get('/history', auth, async (req, res, next) => {
  try {
    const page  = Number(req.query.page  || 1);
    const limit = Number(req.query.limit || 20);

    const [payments, total] = await Promise.all([
      Payment.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Payment.countDocuments({ user: req.user._id }),
    ]);

    res.json({
      success: true,
      data: {
        payments,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
