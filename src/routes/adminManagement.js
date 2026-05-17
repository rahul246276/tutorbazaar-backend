const express = require('express');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Tutor = require('../models/Tutor');
const Lead = require('../models/Lead');
const Payment = require('../models/Payment');
const NotificationLog = require('../models/NotificationLog');
const Review = require('../models/Review');
const ContactMessage = require('../models/ContactMessage');
const SiteSettings = require('../models/SiteSettings');
const AdminActivityLog = require('../models/AdminActivityLog');
const { logActivity } = require('../middleware/activityLog');
const { sendBulk } = require('../services/notificationService');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');

const router = express.Router();

const parsePagination = (query) => {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const getReviewStatus = (review) => {
  if (review.rejectedReason) return 'rejected';
  if (review.isApproved) return 'approved';
  return 'pending';
};

router.get('/plans', async (req, res, next) => {
  try {
    const plans = await SubscriptionPlan.find({}).sort({ sortOrder: 1 }).lean();
    res.json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
});

router.post('/plans', async (req, res, next) => {
  try {
    const { name, price, duration, validityDays, enquiries, enquiryCount, features, description, popular, isPopular, status, isActive, badge } = req.body;
    
    // Get the highest sortOrder to place new plan at the end
    const lastPlan = await SubscriptionPlan.findOne().sort({ sortOrder: -1 });
    const sortOrder = lastPlan ? lastPlan.sortOrder + 1 : 1;
    
    const plan = new SubscriptionPlan({
      name: String(name || '').toLowerCase(),
      displayName: req.body.displayName || String(name || '').toUpperCase(),
      price: Number(price),
      validityDays: Number(validityDays || duration || 150),
      enquiryCount: Number(enquiryCount || enquiries || 0),
      features: features && typeof features === 'object' && !Array.isArray(features) ? features : undefined,
      description,
      isPopular: Boolean(isPopular ?? popular),
      isActive: status ? status === 'active' : isActive !== false,
      badge: badge || '',
      sortOrder
    });
    
    await plan.save();
    await logActivity(req, 'create_plan', 'plan', plan._id, plan.name, req.body);
    
    res.status(201).json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
});

router.delete('/plans/:id', async (req, res, next) => {
  try {
    const plan = await SubscriptionPlan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    
    await logActivity(req, 'delete_plan', 'plan', plan._id, plan.name, { planName: plan.name });
    
    res.json({ success: true, message: 'Plan deleted successfully' });
  } catch (error) {
    next(error);
  }
});

router.put('/plans/:id', async (req, res, next) => {
  try {
    const updates = { ...req.body };
    if (updates.duration !== undefined && updates.validityDays === undefined) updates.validityDays = Number(updates.duration);
    if (updates.enquiries !== undefined && updates.enquiryCount === undefined) updates.enquiryCount = Number(updates.enquiries);
    if (updates.popular !== undefined && updates.isPopular === undefined) updates.isPopular = Boolean(updates.popular);
    if (updates.status !== undefined && updates.isActive === undefined) updates.isActive = updates.status === 'active';
    if (updates.name) updates.name = String(updates.name).toLowerCase();
    if (updates.displayName === undefined && updates.name) updates.displayName = String(updates.name).toUpperCase();
    delete updates.duration;
    delete updates.enquiries;
    delete updates.popular;
    delete updates.status;

    const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    await logActivity(req, 'update_plan', 'plan', plan._id, plan.name, req.body);
    res.json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
});

router.post('/notifications/send', async (req, res, next) => {
  try {
    const filter = {};
    if (req.body.target === 'by_plan' && req.body.planName) filter['subscription.currentPlanName'] = req.body.planName;
    if (req.body.target === 'expiring_soon') {
      filter['subscription.status'] = 'active';
      filter['subscription.expiryDate'] = { $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };
    }
    if (req.body.target === 'specific' && Array.isArray(req.body.tutorIds)) filter._id = { $in: req.body.tutorIds };
    const tutors = await Tutor.find(filter).select('email firstName lastName').lean();
    const result = await sendBulk(tutors, {
      title: req.body.title,
      message: req.body.message,
      channels: req.body.channels || { inApp: true, email: false, sms: false },
      sentBy: req.userId,
      target: req.body.target || 'custom',
    });
    await logActivity(req, 'send_notification', 'other', null, 'Bulk notification', req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.get('/notifications/history', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const logs = await NotificationLog.find({})
      .sort({ sentAt: -1 })
      .limit(limit)
      .skip(skip)
      .lean();
    
    const total = await NotificationLog.countDocuments();
    
    res.json({ 
      success: true, 
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/reviews', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};

    if (req.query.status === 'pending') {
      filter.isApproved = false;
      filter.$or = [{ rejectedReason: { $exists: false } }, { rejectedReason: '' }, { rejectedReason: null }];
    }
    if (req.query.status === 'approved') filter.isApproved = true;
    if (req.query.status === 'rejected') filter.rejectedReason = { $exists: true, $nin: ['', null] };

    const reviews = await Review.find(filter)
      .populate('tutor', 'firstName lastName')
      .populate('student', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    const search = String(req.query.search || '').trim().toLowerCase();
    const filteredReviews = search
      ? reviews.filter((review) =>
          [
            review.review,
            `${review.student?.firstName || ''} ${review.student?.lastName || ''}`.trim(),
            `${review.tutor?.firstName || ''} ${review.tutor?.lastName || ''}`.trim(),
          ]
            .join(' ')
            .toLowerCase()
            .includes(search)
        )
      : reviews;

    const paginatedReviews = filteredReviews
      .slice(skip, skip + limit)
      .map((review) => ({ ...review, status: getReviewStatus(review) }));

    res.json({
      success: true,
      data: paginatedReviews,
      pagination: {
        page,
        limit,
        total: filteredReviews.length,
        pages: Math.ceil(filteredReviews.length / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/reviews/:id', async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id).populate('tutor student').lean();
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    res.json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
});

router.put('/reviews/:id/approve', async (req, res, next) => {
  try {
    const review = await Review.findByIdAndUpdate(req.params.id, { isApproved: true, approvedBy: req.userId, rejectedReason: '' }, { new: true });
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    await logActivity(req, 'approve_review', 'review', review._id, String(review._id));
    res.json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
});

router.put('/reviews/:id/reject', async (req, res, next) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { isApproved: false, approvedBy: null, rejectedReason: req.body.reason || 'Rejected by admin' },
      { new: true }
    );
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    await logActivity(req, 'reject_review', 'review', review._id, String(review._id), req.body);
    res.json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
});

router.delete('/reviews/:id', async (req, res, next) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Review deleted' });
  } catch (error) {
    next(error);
  }
});

router.get('/contact', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};

    if (req.query.status && req.query.status !== 'all') {
      filter.status = req.query.status === 'unread' ? 'new' : req.query.status;
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { subject: searchRegex },
        { message: searchRegex },
      ];
    }

    const [messages, total] = await Promise.all([
      ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ContactMessage.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: messages,
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
});

router.get('/contact/:id', async (req, res, next) => {
  try {
    const message = await ContactMessage.findByIdAndUpdate(req.params.id, { status: 'read' }, { new: true }).lean();
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    res.json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
});

router.post('/contact/:id/reply', async (req, res, next) => {
  try {
    if (!req.body.message || !String(req.body.message).trim()) {
      return res.status(400).json({ success: false, message: 'Reply message is required' });
    }

    const message = await ContactMessage.findByIdAndUpdate(
      req.params.id,
      { status: 'replied', reply: { message: String(req.body.message).trim(), repliedAt: new Date(), repliedBy: req.userId } },
      { new: true }
    );
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    try {
      await sendEmail({
        to: message.email,
        subject: `Re: ${message.subject}`,
        html: `
          <p>Hello ${message.name},</p>
          <p>Thank you for contacting TutorBazaar.</p>
          <p>${String(req.body.message).trim().replace(/\n/g, '<br />')}</p>
          <p>Regards,<br />TutorBazaar Support</p>
        `,
        text: `Hello ${message.name},\n\nThank you for contacting TutorBazaar.\n\n${String(req.body.message).trim()}\n\nRegards,\nTutorBazaar Support`,
      });
    } catch (emailError) {
      logger.warn('Contact reply email failed: %s', emailError.message);
    }

    await logActivity(req, 'other', 'other', message._id, `Reply to ${message.email}`, {
      type: 'reply_contact_message',
      subject: message.subject,
    });
    res.json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
});

router.delete('/contact/:id', async (req, res, next) => {
  try {
    const message = await ContactMessage.findByIdAndDelete(req.params.id);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    await logActivity(req, 'other', 'other', message._id, `Delete contact ${message.email}`, {
      type: 'delete_contact_message',
      subject: message.subject,
    });
    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    next(error);
  }
});

router.get('/settings', async (req, res, next) => {
  try {
    let settings = await SiteSettings.findById('main').lean();
    if (!settings) settings = await SiteSettings.create({ _id: 'main' });
    res.json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    const settings = await SiteSettings.findByIdAndUpdate('main', { ...req.body, updatedAt: new Date(), updatedBy: req.userId }, { new: true, upsert: true });
    await logActivity(req, 'update_settings', 'settings', null, 'Site settings', req.body);
    res.json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
});

router.get('/activity-log', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.action && req.query.action !== 'all') filter.action = req.query.action;
    if (req.query.user && req.query.user !== 'all') filter['user.name'] = new RegExp(req.query.user, 'i');
    if (req.query.dateRange) {
      const now = new Date();
      let startDate;
      if (req.query.dateRange === '1d') startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      else if (req.query.dateRange === '7d') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      else if (req.query.dateRange === '30d') startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      else if (req.query.dateRange === '90d') startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      if (startDate) filter.createdAt = { $gte: startDate };
    }
    if (req.query.search) {
      filter.$or = [
        { description: new RegExp(req.query.search, 'i') },
        { 'user.name': new RegExp(req.query.search, 'i') },
        { action: new RegExp(req.query.search, 'i') },
      ];
    }
    const [logs, total] = await Promise.all([
      AdminActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AdminActivityLog.countDocuments(filter),
    ]);
    res.json({ success: true, data: logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    next(error);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const { q: query } = req.query;
    if (!query || query.length < 3) {
      return res.json({ success: true, data: [] });
    }

    const searchRegex = new RegExp(query, 'i');
    const results = [];

    // Search tutors
    const tutors = await Tutor.find({
      $or: [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ]
    }).limit(5).lean();

    tutors.forEach(tutor => {
      results.push({
        type: 'tutor',
        title: `${tutor.firstName} ${tutor.lastName}`,
        description: tutor.email,
        path: `/admin/tutors/${tutor._id}`,
        metadata: {
          status: tutor.isApproved ? 'approved' : 'pending',
          city: tutor.city,
          plan: tutor.subscription?.currentPlanName || 'none'
        }
      });
    });

    // Search students
    const students = await require('../models/Student').find({
      $or: [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ]
    }).limit(5).lean();

    students.forEach(student => {
      results.push({
        type: 'student',
        title: `${student.firstName} ${student.lastName}`,
        description: student.email,
        path: `/admin/students/${student._id}`,
        metadata: {
          status: student.status || 'active',
          city: student.city
        }
      });
    });

    // Search leads
    const leads = await Lead.find({
      $or: [
        { 'student.name': searchRegex },
        { 'student.email': searchRegex },
        { 'student.phone': searchRegex },
        { 'requirements.subjects': searchRegex },
        { leadId: searchRegex },
      ]
    }).limit(5).lean();

    leads.forEach(lead => {
      results.push({
        type: 'lead',
        title: `Lead ${lead._id?.slice(-8)}`,
        description: `${lead.student?.name} - ${(lead.requirements?.subjects || []).join(', ')}`,
        path: `/admin/leads/${lead._id}`,
        metadata: {
          status: lead.status,
          city: lead.requirements?.city,
          date: new Date(lead.createdAt).toLocaleDateString()
        }
      });
    });

    // Search payments
    const payments = await Payment.find({
      $or: [
        { invoiceNumber: searchRegex },
        { 'tutor.firstName': searchRegex },
        { 'tutor.lastName': searchRegex },
        { 'tutor.email': searchRegex },
      ]
    }).limit(5).lean();

    payments.forEach(payment => {
      results.push({
        type: 'payment',
        title: `Payment ${payment.invoiceNumber || payment._id?.slice(-8)}`,
        description: `${payment.tutor?.firstName} ${payment.tutor?.lastName}`,
        path: `/admin/payments/${payment._id}`,
        metadata: {
          status: payment.status,
          amount: payment.amount,
          date: new Date(payment.createdAt).toLocaleDateString()
        }
      });
    });

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
