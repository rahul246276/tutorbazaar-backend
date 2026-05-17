const express = require('express');
const mongoose = require('mongoose');
const Tutor = require('../models/Tutor');
const Lead = require('../models/Lead');
const Payment = require('../models/Payment');
const Review = require('../models/Review');
const TutorPlanSubscription = require('../models/TutorPlanSubscription');
const User = require('../models/User');
const { logActivity } = require('../middleware/activityLog');
const { activatePlan, addEnquiries, extendExpiry } = require('../services/planService');
const { sendToTutor } = require('../services/notificationService');
const { assignLeadToTutors } = require('../services/leadService');

const router = express.Router();

const parsePagination = (query) => {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const buildFilter = (query) => {
  const filter = {};
  if (query.status === 'pending') filter.isApproved = false;
  if (query.status === 'approved') filter.isApproved = true;
  if (query.status === 'suspended') filter['suspension.isSuspended'] = true;
  if (query.status === 'featured') filter.isFeatured = true;
  if (query.plan && query.plan !== 'all') filter['subscription.currentPlanName'] = query.plan;
  if (query.city && query.city !== 'all') filter.city = new RegExp(query.city, 'i');
  if (query.search) {
    filter.$or = [
      { firstName: new RegExp(query.search, 'i') },
      { lastName: new RegExp(query.search, 'i') },
      { email: new RegExp(query.search, 'i') },
      { phone: new RegExp(query.search, 'i') },
    ];
  }
  return filter;
};

const toCsv = (rows) => {
  const headers = ['Name', 'Email', 'Phone', 'City', 'Plan', 'Status'];
  const lines = rows.map((row) => [
    `${row.firstName} ${row.lastName}`,
    row.email,
    row.phone,
    row.city,
    row.subscription?.currentPlanName || 'none',
    row.suspension?.isSuspended ? 'suspended' : row.isApproved ? 'approved' : 'pending',
  ]);
  return [headers.join(','), ...lines.map((line) => line.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','))].join('\n');
};

router.get('/tutors/export', async (req, res, next) => {
  try {
    const tutors = await Tutor.find(buildFilter(req.query)).lean();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tutors.csv"');
    res.send(toCsv(tutors));
  } catch (error) {
    next(error);
  }
});

router.get('/tutors', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = buildFilter(req.query);
    const [tutors, total] = await Promise.all([
      Tutor.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Tutor.countDocuments(filter),
    ]);
    res.json({ success: true, data: tutors, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    next(error);
  }
});

router.get('/tutors/:id', async (req, res, next) => {
  try {
    const [tutor, paymentHistory, leads, subscription, reviews] = await Promise.all([
      Tutor.findById(req.params.id).lean(),
      Payment.find({ user: req.params.id }).sort({ createdAt: -1 }).lean(),
      Lead.find({ 'lockedBy.tutor': req.params.id }).sort({ createdAt: -1 }).lean(),
      TutorPlanSubscription.find({ tutor: req.params.id }).sort({ createdAt: -1 }).lean(),
      Review.find({ tutor: req.params.id }).sort({ createdAt: -1 }).lean(),
    ]);
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    res.json({ success: true, data: { tutor, paymentHistory, leads, subscription, reviews } });
  } catch (error) {
    next(error);
  }
});

router.put('/tutors/:id/approve', async (req, res, next) => {
  try {
    const tutor = await Tutor.findByIdAndUpdate(
      req.params.id,
      { isApproved: true, approvedAt: new Date(), approvedBy: req.userId, isActive: true, 'suspension.isSuspended': false },
      { new: true }
    );
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    await sendToTutor(tutor._id, {
      type: 'profile_approved',
      title: 'Profile approved',
      message: req.body.customMessage || 'Your TutorBazaar profile has been approved.',
      channels: { inApp: true, email: Boolean(req.body.sendEmail && tutor.email), sms: false },
      emailTo: req.body.sendEmail ? tutor.email : '',
    });
    if (req.io) req.io.to(`tutor_${tutor._id}`).emit('profile_approved', { message: 'Your profile has been approved.' });
    await logActivity(req, 'approve_tutor', 'tutor', tutor._id, `${tutor.firstName} ${tutor.lastName}`);
    res.json({ success: true, data: tutor });
  } catch (error) {
    next(error);
  }
});

router.put('/tutors/:id/suspend', async (req, res, next) => {
  try {
    const tutor = await Tutor.findByIdAndUpdate(
      req.params.id,
      {
        isActive: false,
        suspension: {
          isSuspended: true,
          reason: req.body.reason,
          customReason: req.body.customReason || '',
          suspendedAt: new Date(),
          suspendedBy: req.userId,
        },
      },
      { new: true }
    );
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    await sendToTutor(tutor._id, {
      type: 'system',
      title: 'Profile suspended',
      message: `Your account has been suspended. Reason: ${req.body.customReason || req.body.reason}`,
      channels: { inApp: true, email: Boolean(req.body.sendEmail && tutor.email), sms: false },
      emailTo: req.body.sendEmail ? tutor.email : '',
    });
    if (req.io) req.io.to(`tutor_${tutor._id}`).emit('profile_suspended', { reason: req.body.customReason || req.body.reason });
    await logActivity(req, 'suspend_tutor', 'tutor', tutor._id, `${tutor.firstName} ${tutor.lastName}`, req.body);
    res.json({ success: true, data: tutor });
  } catch (error) {
    next(error);
  }
});

router.put('/tutors/:id/reactivate', async (req, res, next) => {
  try {
    const tutor = await Tutor.findByIdAndUpdate(
      req.params.id,
      { isActive: true, 'suspension.isSuspended': false, 'suspension.reason': '', 'suspension.customReason': '' },
      { new: true }
    );
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    await logActivity(req, 'reactivate_tutor', 'tutor', tutor._id, `${tutor.firstName} ${tutor.lastName}`);
    res.json({ success: true, data: tutor });
  } catch (error) {
    next(error);
  }
});

router.put('/tutors/:id/featured', async (req, res, next) => {
  try {
    const featuredUntil = req.body.isFeatured ? new Date(Date.now() + Number(req.body.durationDays || 30) * 24 * 60 * 60 * 1000) : null;
    const tutor = await Tutor.findByIdAndUpdate(req.params.id, { isFeatured: Boolean(req.body.isFeatured), featuredUntil }, { new: true });
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    await logActivity(req, 'featured_tutor', 'tutor', tutor._id, `${tutor.firstName} ${tutor.lastName}`, req.body);
    res.json({ success: true, data: tutor });
  } catch (error) {
    next(error);
  }
});

router.put('/tutors/:id', async (req, res, next) => {
  try {
    const tutor = await Tutor.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    await logActivity(req, 'edit_tutor', 'tutor', tutor._id, `${tutor.firstName} ${tutor.lastName}`);
    res.json({ success: true, data: tutor });
  } catch (error) {
    next(error);
  }
});

router.post('/tutors/:id/assign-lead', async (req, res, next) => {
  try {
    const [lead, tutor] = await Promise.all([Lead.findById(req.body.leadId), Tutor.findById(req.params.id)]);
    if (!lead || !tutor) return res.status(404).json({ success: false, message: 'Tutor or lead not found' });
    const result = await assignLeadToTutors(req.body.leadId, [req.params.id], {
      adminId: req.userId,
      reason: req.body.reason || 'Assigned from tutor profile',
      io: req.io,
    });
    await logActivity(req, 'assign_lead', 'lead', lead._id, lead.leadId, { tutorId: tutor._id });
    res.json({ success: true, data: result.lead });
  } catch (error) {
    next(error);
  }
});

router.post('/tutors/:id/activate-plan', async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const tutor = await Tutor.findById(req.params.id).session(session);
    if (!tutor) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Tutor not found' });
    }
    const paymentDocs = await Payment.create(
      [{
        razorpayOrderId: `manual_${Date.now()}_${tutor._id}`,
        user: tutor._id,
        userType: 'tutor',
        type: 'admin_activation',
        amount: Number(req.body.amount || 0),
        finalAmount: Number(req.body.amount || 0),
        status: 'paid',
        method: req.body.paymentMethod || 'manual',
        reference: req.body.reference || '',
        notes: req.body.notes || '',
        activatedByAdmin: true,
        subscriptionPlan: { name: req.body.planName, displayName: String(req.body.planName || '').toUpperCase() },
      }],
      { session }
    );
    const result = await activatePlan(req.params.id, req.body.planName, {
      payment: paymentDocs[0],
      paymentMethod: req.body.paymentMethod || 'manual',
      notes: req.body.notes || '',
      durationDays: Number(req.body.durationDays || 150),
      enquiryCount: Number(req.body.enquiryCount || 0) || undefined,
      activatedBy: 'admin',
    }, session);
    await session.commitTransaction();
    await sendToTutor(tutor._id, {
      type: 'plan_activated',
      title: 'Plan activated',
      message: `${result.plan.displayName} has been activated on your account.`,
      channels: { inApp: true, email: true, sms: false },
      emailTo: tutor.email,
    });
    if (req.io) req.io.to(`tutor_${tutor._id}`).emit('plan_activated', { planName: result.plan.name, expiry: result.expiryDate, enquiries: result.enquiriesGranted });
    await logActivity(req, 'activate_plan', 'tutor', tutor._id, `${tutor.firstName} ${tutor.lastName}`, req.body);
    res.json({ success: true, data: result.subscription });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
});

router.post('/tutors/:id/add-enquiries', async (req, res, next) => {
  try {
    const subscription = await addEnquiries(req.params.id, Number(req.body.count || 0), req.body.reason || '');
    await logActivity(req, 'add_enquiries', 'tutor', req.params.id, 'Tutor', req.body);
    res.json({ success: true, data: subscription });
  } catch (error) {
    next(error);
  }
});

router.post('/tutors/:id/extend-plan', async (req, res, next) => {
  try {
    const subscription = await extendExpiry(req.params.id, Number(req.body.days || 0), req.body.reason || '');
    await logActivity(req, 'extend_plan', 'tutor', req.params.id, 'Tutor', req.body);
    res.json({ success: true, data: subscription });
  } catch (error) {
    next(error);
  }
});

router.delete('/tutors/:id', async (req, res, next) => {
  try {
    await Tutor.findByIdAndDelete(req.params.id);
    await Lead.updateMany({}, { $pull: { lockedBy: { tutor: req.params.id } } });
    res.json({ success: true, message: 'Tutor deleted' });
  } catch (error) {
    next(error);
  }
});

// Create tutor endpoint
router.post('/tutors', async (req, res, next) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      city,
      locality,
      bio,
      headline,
      subjects,
      experienceYears,
      experienceDetails,
      teachingModes,
      hourlyRate,
      monthlyRate,
      education,
      isApproved = false,
      isActive = true
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'Required fields are missing' });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const tutor = new Tutor({
      firstName,
      lastName,
      email,
      password,
      role: 'tutor',
      phone,
      city: city || 'Unknown',
      locality: locality || '',
      bio,
      headline,
      subjects: subjects || [],
      experience: {
        years: experienceYears || 0,
        details: experienceDetails || ''
      },
      teachingModes: teachingModes || ['both'],
      pricing: {
        hourlyRate: hourlyRate || 0,
        monthlyRate: monthlyRate || 0
      },
      education: education || [],
      isApproved,
      isActive,
      metrics: {
        unlockedLeads: 0,
        totalEarnings: 0,
        responseTime: 0
      }
    });
    await tutor.save();

    await logActivity(req, 'create_tutor', 'tutor', tutor._id, `${firstName} ${lastName}`, req.body);

    res.status(201).json({ 
      success: true, 
      message: 'Tutor created successfully', 
      data: tutor 
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
