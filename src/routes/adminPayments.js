const express = require('express');
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Tutor = require('../models/Tutor');
const { logActivity } = require('../middleware/activityLog');
const { activatePlan, getActiveSubscription, syncTutorSubscription } = require('../services/planService');

const router = express.Router();

const parsePagination = (query) => {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const toCsv = (rows) => {
  const headers = ['Invoice', 'Tutor', 'Plan', 'Amount', 'Final', 'Method', 'Status'];
  const lines = rows.map((row) => [
    row.invoiceNumber || row.reference || row.razorpayOrderId,
    row.user?.email || row.user,
    row.subscriptionPlan?.name || row.type,
    row.amount,
    row.finalAmount || row.amount,
    row.method || 'razorpay',
    row.status,
  ]);
  return [headers.join(','), ...lines.map((line) => line.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','))].join('\n');
};

router.get('/payments/export', async (req, res, next) => {
  try {
    const payments = await Payment.find({}).populate('user', 'email').lean();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
    res.send(toCsv(payments));
  } catch (error) {
    next(error);
  }
});

router.get('/payments', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.plan && req.query.plan !== 'all') filter['subscriptionPlan.name'] = req.query.plan;
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    if (req.query.method && req.query.method !== 'all') filter.method = req.query.method;
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) filter.createdAt.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.createdAt.$lte = new Date(req.query.endDate);
    }
    const [payments, total] = await Promise.all([
      Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'firstName lastName email').lean(),
      Payment.countDocuments(filter),
    ]);
    res.json({ success: true, data: payments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    next(error);
  }
});

router.post('/payments/manual', async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const tutor = await Tutor.findById(req.body.tutorId).session(session);
    if (!tutor) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Tutor not found' });
    }

    const paymentDocs = await Payment.create(
      [{
        razorpayOrderId: `manual_${Date.now()}_${tutor._id}`,
        user: tutor._id,
        userType: 'tutor',
        type: 'subscription',
        amount: Number(req.body.amount),
        finalAmount: Number(req.body.amount),
        status: 'paid',
        method: req.body.method || 'manual',
        reference: req.body.reference || '',
        notes: req.body.notes || '',
        activatedByAdmin: true,
        paidAt: req.body.date ? new Date(req.body.date) : new Date(),
        subscriptionPlan: { name: req.body.planName, displayName: String(req.body.planName || '').toUpperCase() },
      }],
      { session }
    );

    let subscription = null;
    if (req.body.activatePlan) {
      subscription = await activatePlan(req.body.tutorId, req.body.planName, {
        payment: paymentDocs[0],
        paymentMethod: req.body.method || 'manual',
        notes: req.body.notes || '',
        activatedBy: 'admin',
      }, session);
    }

    await session.commitTransaction();
    res.status(201).json({ success: true, data: { payment: paymentDocs[0], subscription } });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
});

router.post('/payments/:id/refund', async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    payment.status = 'refunded';
    payment.refund = {
      amount: Number(req.body.amount || payment.finalAmount || payment.amount),
      reason: req.body.reason || '',
      status: 'processed',
      processedAt: new Date(),
    };
    await payment.save();

    if ((payment.finalAmount || payment.amount) <= Number(req.body.amount || payment.finalAmount || payment.amount)) {
      const subscription = await getActiveSubscription(payment.user);
      if (subscription) {
        subscription.status = 'cancelled';
        await subscription.save();
        await syncTutorSubscription(payment.user, subscription);
      }
    }

    await logActivity(req, 'refund_payment', 'payment', payment._id, payment.invoiceNumber || payment.razorpayOrderId, req.body);
    res.json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
