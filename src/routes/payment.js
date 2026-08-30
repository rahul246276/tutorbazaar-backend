/**
 * Payment routes
 *
 * BUGS FIXED:
 * - Removed duplicate /tutors/plans/* routes that were mounted at the wrong
 *   path prefix (/api/payments/tutors/...) — these are already defined in
 *   tutor.js at the correct /api/tutors/plans/* paths.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Payment = require('../models/Payment');
const OnlinePayment = require('../models/OnlinePayment');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const razorpay = require('../config/razorpay');
const logger = require('../utils/logger');
const { handlePaymentWebhook, getAllPlans } = require('../controllers/planController');

const GST_RATE = 18;
const MAX_RAZORPAY_AMOUNT = 500000;

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const signaturesMatch = (actual = '', expected = '') => {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

const createReceipt = (selectionType, label) =>
  `tb_online_${Date.now().toString(36)}_${String(selectionType).slice(0, 3)}_${String(label || 'pay').slice(0, 6)}`;

// Public: list plans
router.get('/plans', getAllPlans);

// Public: create an online payment order for plan or custom amount.
router.post('/online/create-order', async (req, res, next) => {
  try {
    if (!razorpay) {
      return res.status(503).json({
        success: false,
        message: 'Razorpay is not configured on this environment.',
      });
    }

    const {
      selectionType = 'custom',
      planName,
      customAmount,
      customer = {},
    } = req.body || {};

    const type = selectionType === 'plan' ? 'plan' : 'custom';
    let baseAmount = Number(customAmount || 0);
    let plan = null;

    if (type === 'plan') {
      plan = await SubscriptionPlan.findOne({ name: String(planName || '').toLowerCase(), isActive: true }).lean();
      if (!plan) {
        return res.status(404).json({ success: false, message: 'Selected plan was not found.' });
      }
      baseAmount = Number(plan.price || 0);
    }

    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Enter a valid payment amount.' });
    }

    if (baseAmount > MAX_RAZORPAY_AMOUNT) {
      return res.status(400).json({
        success: false,
        message: `Amount cannot be more than Rs. ${MAX_RAZORPAY_AMOUNT.toLocaleString('en-IN')}.`,
      });
    }

    const gstAmount = roundMoney((baseAmount * GST_RATE) / 100);
    const totalAmount = roundMoney(baseAmount + gstAmount);

    const order = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100),
      currency: 'INR',
      receipt: createReceipt(type, plan?.name || 'custom'),
      notes: {
        paymentType: 'online_public',
        selectionType: type,
        planName: plan?.name || '',
        baseAmount: String(baseAmount),
        gstAmount: String(gstAmount),
      },
    });

    const onlinePayment = await OnlinePayment.create({
      razorpayOrderId: order.id,
      payer: {
        name: customer.name || '',
        email: customer.email || '',
        phone: customer.phone || '',
      },
      selectionType: type,
      planName: plan?.name,
      description: plan ? `${plan.displayName || plan.name} Plan` : 'Custom online payment',
      baseAmount,
      gstRate: GST_RATE,
      gstAmount,
      totalAmount,
      currency: 'INR',
      status: 'created',
      metadata: {
        source: 'membership_pay_online',
      },
    });

    res.status(201).json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID || '',
        paymentId: onlinePayment._id,
        baseAmount,
        gstRate: GST_RATE,
        gstAmount,
        totalAmount,
        description: onlinePayment.description,
        prefill: {
          name: onlinePayment.payer.name,
          email: onlinePayment.payer.email,
          contact: onlinePayment.payer.phone,
        },
      },
    });
  } catch (error) {
    logger.error('Online payment order creation failed:', error.message);
    next(error);
  }
});

// Public: verify Razorpay payment signature after Checkout succeeds.
router.post('/online/verify', async (req, res, next) => {
  try {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({
        success: false,
        message: 'Razorpay is not configured on this environment.',
      });
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification details are missing.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (!signaturesMatch(razorpay_signature, expectedSignature)) {
      return res.status(400).json({ success: false, message: 'Invalid payment signature.' });
    }

    const onlinePayment = await OnlinePayment.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      {
        $set: {
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          status: 'paid',
          paidAt: new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!onlinePayment) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    res.json({
      success: true,
      message: 'Payment verified successfully.',
      data: {
        paymentId: onlinePayment._id,
        status: onlinePayment.status,
        totalAmount: onlinePayment.totalAmount,
      },
    });
  } catch (error) {
    next(error);
  }
});

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
