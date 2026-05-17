const crypto = require('crypto');
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const PromoCode = require('../models/PromoCode');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Tutor = require('../models/Tutor');
const TutorPlanSubscription = require('../models/TutorPlanSubscription');
const razorpay = require('../config/razorpay');
const logger = require('../utils/logger');
const { activatePlan, getActiveSubscription } = require('../services/planService');
const { sendToTutor } = require('../services/notificationService');

const signaturesMatch = (actual = '', expected = '') => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

const createRazorpayReceipt = (tutorId, planName) =>
  `tb_${Date.now().toString(36)}_${String(tutorId).slice(-6)}_${String(planName).slice(0, 2)}`;

const getAllPlans = async (req, res, next) => {
  try {
    const plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    res.json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
};

const createPlanOrder = async (req, res, next) => {
  try {
    if (!razorpay) {
      return res.status(503).json({
        success: false,
        message: 'Razorpay is not configured on this environment.',
      });
    }

    const { planName, promoCode } = req.body;
    const tutor = await Tutor.findById(req.user._id);
    const plan = await SubscriptionPlan.findOne({ name: planName?.toLowerCase(), isActive: true });

    if (!tutor || !plan) {
      return res.status(404).json({ success: false, message: 'Tutor or plan not found' });
    }

    let discountAmount = 0;
    let appliedPromo = null;

    if (promoCode) {
      const promo = await PromoCode.findOne({ code: promoCode.toUpperCase(), isActive: true });
      if (!promo || !promo.canBeUsed()) {
        return res.status(400).json({ success: false, message: 'Invalid or expired promo code' });
      }

      if (Array.isArray(promo.applicablePlans) && promo.applicablePlans.length && !promo.applicablePlans.includes(plan.name)) {
        return res.status(400).json({ success: false, message: 'Promo code is not valid for this plan' });
      }

      discountAmount = promo.calculateDiscount(plan.price);
      appliedPromo = promo;
    }

    const finalAmount = Math.max(plan.price - discountAmount, 0);
    if (finalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Plan amount must be greater than zero for online payment.',
      });
    }

    let order;
    try {
      order = await razorpay.orders.create({
        amount: Math.round(finalAmount * 100),
        currency: 'INR',
        receipt: createRazorpayReceipt(tutor._id, plan.name),
        notes: {
          tutorId: String(tutor._id),
          planName: plan.name,
        },
      });
    } catch (error) {
      logger.error('Razorpay order creation failed:', {
        message: error.message,
        statusCode: error.statusCode,
        gatewayError: error.error,
      });

      return res.status(error.statusCode || 502).json({
        success: false,
        message: error.error?.description || error.message || 'Payment gateway could not create the order.',
      });
    }

    const payment = await Payment.create({
      razorpayOrderId: order.id,
      user: tutor._id,
      userType: 'tutor',
      type: 'subscription',
      amount: plan.price,
      discountAmount,
      finalAmount,
      currency: 'INR',
      status: 'created',
      method: 'razorpay',
      subscriptionPlan: {
        name: plan.name,
        displayName: plan.displayName,
        price: plan.price,
        enquiryCount: plan.enquiryCount,
        validityDays: plan.validityDays,
      },
      promoCode: appliedPromo
        ? {
            code: appliedPromo.code,
            discountType: appliedPromo.discountType,
            discountValue: appliedPromo.discountValue,
          }
        : undefined,
      promoCodeId: appliedPromo?._id,
      metadata: {
        planName: plan.name,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID || '',
        amountInRupees: finalAmount,
        originalPrice: plan.price,
        discountAmount,
        planName: plan.name,
        planDisplayName: plan.displayName,
        paymentId: payment._id,
        prefill: {
          name: `${tutor.firstName} ${tutor.lastName}`,
          email: tutor.email,
          contact: tutor.phone || '',
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const verifyPlanPayment = async (req, res, next) => {
  if (!process.env.RAZORPAY_KEY_SECRET) {
    return res.status(503).json({
      success: false,
      message: 'Razorpay is not configured on this environment.',
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      planName,
    } = req.body;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (!signaturesMatch(razorpay_signature, expectedSignature)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }

    const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id }).session(session);
    if (!payment) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Payment record not found' });
    }

    if (payment.status === 'paid' && payment.subscriptionActivated) {
      await session.abortTransaction();
      return res.json({ success: true, message: 'Payment already verified', data: { paymentId: payment._id } });
    }

    payment.razorpayPaymentId = razorpay_payment_id;
    payment.razorpaySignature = razorpay_signature;
    payment.status = 'paid';
    payment.paidAt = new Date();

    const result = await activatePlan(req.user._id, planName || payment.subscriptionPlan?.name, { payment }, session);
    payment.subscriptionActivated = true;
    payment.subscriptionId = result.subscription._id;

    if (payment.promoCodeId) {
      await PromoCode.findByIdAndUpdate(
        payment.promoCodeId,
        {
          $inc: { usedCount: 1 },
          $push: {
            usageHistory: {
              tutor: req.user._id,
              plan: result.plan.name,
              discountAmount: payment.discountAmount || 0,
            },
          },
        },
        { session }
      );
    }

    await payment.save({ session });
    await session.commitTransaction();

    await sendToTutor(req.user._id, {
      type: 'plan_activated',
      title: `${result.plan.displayName} plan activated`,
      message: `Your plan is active until ${result.expiryDate.toLocaleDateString('en-IN')}.`,
      data: {
        planName: result.plan.name,
        expiryDate: result.expiryDate,
        enquiries: result.enquiriesGranted,
      },
      channels: { inApp: true, email: Boolean(req.user.email), sms: false },
      emailTo: req.user.email,
    });

    if (global.io) {
      global.io.to(`tutor_${req.user._id}`).emit('plan_activated', {
        planName: result.plan.name,
        expiry: result.expiryDate,
        enquiries: result.enquiriesGranted,
      });
      global.io.to('admin_room').emit('payment_received', {
        payment: { _id: payment._id, amount: payment.finalAmount || payment.amount },
        tutor: { _id: req.user._id, name: `${req.user.firstName} ${req.user.lastName}` },
        plan: result.plan.name,
      });
    }

    res.json({
      success: true,
      message: 'Payment verified and plan activated',
      data: {
        paymentId: payment._id,
        planName: result.plan.name,
        expiryDate: result.expiryDate,
        enquiriesGranted: result.enquiriesGranted,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

const getCurrentPlan = async (req, res, next) => {
  try {
    const subscription = await getActiveSubscription(req.user._id);
    if (!subscription) {
      return res.json({ success: true, data: null });
    }

    res.json({
      success: true,
      data: {
        subscriptionId: subscription._id,
        planName: subscription.plan,
        displayName: subscription.planSnapshot?.displayName || subscription.plan,
        expiryDate: subscription.expiryDate,
        daysRemaining: subscription.daysRemaining,
        enquiriesTotal: subscription.totalEnquiries + subscription.extraEnquiries,
        enquiriesUsed: subscription.usedEnquiries,
        enquiriesRemaining: subscription.remainingEnquiries,
        startDate: subscription.startDate,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getPlanHistory = async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);

    const [items, total] = await Promise.all([
      TutorPlanSubscription.find({ tutor: req.user._id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TutorPlanSubscription.countDocuments({ tutor: req.user._id }),
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

const handlePaymentWebhook = async (req, res) => {
  try {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      logger.warn('Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not configured');
      return res.status(503).json({ error: 'Webhook is not configured' });
    }

    const signature = req.headers['x-razorpay-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '')
      .update(req.body)
      .digest('hex');

    if (!signaturesMatch(signature, expected)) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const payload = JSON.parse(req.body.toString('utf8'));
    const paymentEntity = payload.payload?.payment?.entity;

    if (paymentEntity?.order_id) {
      await Payment.updateOne(
        { razorpayOrderId: paymentEntity.order_id },
        {
          $set: {
            razorpayPaymentId: paymentEntity.id,
            status: payload.event === 'payment.failed' ? 'failed' : 'paid',
          },
          $push: {
            webhookEvents: {
              event: payload.event,
              receivedAt: new Date(),
              payload: paymentEntity,
            },
          },
        }
      );
    }

    return res.json({ received: true });
  } catch (error) {
    logger.error('Webhook processing error: %s', error.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = {
  createPlanOrder,
  getAllPlans,
  getCurrentPlan,
  getPlanHistory,
  handlePaymentWebhook,
  verifyPlanPayment,
};
