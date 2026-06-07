const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const Tutor = require('../models/Tutor');
const Lead = require('../models/Lead');
const Notification = require('../models/Notification');
const Review = require('../models/Review');
const Payment = require('../models/Payment');
const ContactMessage = require('../models/ContactMessage');
const EnquiryTransaction = require('../models/EnquiryTransaction');
const { createPlanOrder, getCurrentPlan, getPlanHistory, verifyPlanPayment } = require('../controllers/planController');
const { getActiveSubscription } = require('../services/planService');
const {
  addTutorLeadNote,
  buildTutorLeadQuery,
  getAvailableLeadsForTutor,
  getUnlockedLeadsForTutor,
  unlockLeadForTutor,
  updateTutorLeadStatus,
} = require('../services/leadService');

const sanitizeTutor = (tutor) => ({
  ...tutor,
  password: undefined,
  notifications: undefined,
});

const normalizeSubjects = (subjects = []) =>
  (Array.isArray(subjects) ? subjects : [subjects])
    .map((subject) => (typeof subject === 'string' ? { name: subject.trim() } : { ...subject, name: String(subject?.name || '').trim() }))
    .filter((subject) => subject.name);

// ─── Tutor Dashboard ──────────────────────────────────────────────────────────
router.get('/dashboard', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const [tutor, reviews, recentLeads, notifications, availableMatches] = await Promise.all([
      Tutor.findById(req.userId).lean(),
      Review.find({ tutor: req.userId, isApproved: true }).lean(),
      Lead.find({ 'lockedBy.tutor': req.userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Notification.find({ recipient: req.userId, recipientRole: 'tutor' })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Tutor.findById(req.userId).lean().then((profile) =>
        profile ? Lead.countDocuments(buildTutorLeadQuery(profile)) : 0
      ),
    ]);

    const totalReviews = reviews.length;
    const averageRating = totalReviews
      ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(1))
      : 0;

    res.json({
      success: true,
      data: {
        tutor: sanitizeTutor(tutor),
        stats: {
          profileCompletion: tutor.profileCompletion || 0,
          profileViews: tutor.metrics?.profileViews || 0,
          availableMatches,
          enquiriesUnlocked: tutor.metrics?.unlockedLeads || recentLeads.length,
          enquiriesViewed: tutor.metrics?.enquiriesViewed || 0,
          rating: averageRating,
          totalReviews,
          subscription: tutor.subscription,
        },
        recentLeads,
        recentActivity: notifications,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Analytics ────────────────────────────────────────────────────────────────
router.get('/analytics', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const tutor = await Tutor.findById(req.userId).lean();
    const leads = await Lead.find({ 'lockedBy.tutor': req.userId }).sort({ createdAt: -1 }).lean();

    const performance = (tutor.subjects || []).map((subject) => {
      const subjectLeads = leads.filter((lead) => lead.requirements.subjects.includes(subject.name));
      const converted = subjectLeads.filter((lead) => lead.status === 'converted').length;
      return {
        subject: subject.name,
        leadsReceived: subjectLeads.length,
        unlocked: subjectLeads.length,
        converted,
        conversionRate: subjectLeads.length ? Math.round((converted / subjectLeads.length) * 100) : 0,
      };
    });

    res.json({
      success: true,
      data: {
        kpis: {
          profileViews: tutor.metrics?.profileViews || 0,
          enquiriesReceived: leads.length,
          enquiriesUnlocked: tutor.metrics?.unlockedLeads || leads.length,
          conversionRate: tutor.metrics?.conversionRate || 0,
        },
        chartData: leads.map((lead) => ({
          date: new Date(lead.createdAt).toISOString().slice(0, 10),
          subject: lead.requirements.subjects[0],
          city: lead.requirements.city,
          status: lead.status,
        })),
        performance,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Profile ──────────────────────────────────────────────────────────────────
router.get('/profile', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const tutor = await Tutor.findById(req.userId).lean();
    res.json({ success: true, data: { tutor: sanitizeTutor(tutor) } });
  } catch (error) {
    next(error);
  }
});

router.put('/profile', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const allowed = [
      'firstName', 'lastName', 'phone', 'email', 'bio', 'headline', 'city', 'locality',
      'subjects', 'teachingModes', 'pricing', 'education', 'experience',
      'availability', 'documents', 'studentsTaught', 'responseRate', 'preferences',
    ];
    const updates = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });
    if (updates.subjects) updates.subjects = normalizeSubjects(updates.subjects);
    if (updates.teachingModes?.includes('both')) updates.teachingModes = ['both'];

    const tutor = await Tutor.findByIdAndUpdate(req.userId, updates, {
      new: true,
      runValidators: true,
    }).lean();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { tutor: sanitizeTutor(tutor) },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Leads ────────────────────────────────────────────────────────────────────
router.get('/leads/available', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const result = await getAvailableLeadsForTutor(req.userId, req.query);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.get('/leads/my', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const result = await getUnlockedLeadsForTutor(req.userId, req.query);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/leads/:id/unlock', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const result = await unlockLeadForTutor(req.userId, req.params.id, req.io);
    res.json({ success: true, message: 'Lead unlocked successfully', data: result });
  } catch (error) {
    next(error);
  }
});

router.put('/leads/:id/status', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const lead = await updateTutorLeadStatus(req.userId, req.params.id, req.body.status);
    res.json({ success: true, data: { lead } });
  } catch (error) {
    next(error);
  }
});

router.post('/leads/:id/note', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const lead = await addTutorLeadNote(req.userId, req.params.id, req.body.note || '');
    res.json({ success: true, data: { lead } });
  } catch (error) {
    next(error);
  }
});

// ─── Plan routes (served from /api/tutors/plans/*) ───────────────────────────
router.get('/plans/current', auth, authorize('tutor'), getCurrentPlan);
router.get('/plans/history', auth, authorize('tutor'), getPlanHistory);
router.post('/plans/purchase', auth, authorize('tutor'), createPlanOrder);
router.post('/plans/verify', auth, authorize('tutor'), verifyPlanPayment);

// ─── Credits (Enhanced for plan-based credits system)
router.get('/credits', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const [subscription, transactions] = await Promise.all([
      getActiveSubscription(req.userId),
      EnquiryTransaction.find({ tutor: req.userId }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    // If no active subscription, return appropriate response
    if (!subscription) {
      return res.json({
        success: true,
        data: {
          hasPlan: false,
          message: "Buy a plan to view leads",
          balance: null,
          history: transactions,
        },
      });
    }

    const today = new Date();
    const daysLeft = Math.max(0, Math.ceil((subscription.expiryDate - today) / (1000 * 60 * 60 * 24)));
    const isExpired = subscription.status === 'expired' || subscription.expiryDate < today;
    const isLowCredits = subscription.remainingEnquiries <= 5;

    res.json({
      success: true,
      data: {
        hasPlan: true,
        balance: {
          planName: subscription.plan,
          planDisplayName: subscription.planSnapshot?.displayName || subscription.plan?.toUpperCase(),
          remaining: subscription.remainingEnquiries,
          used: subscription.usedEnquiries,
          total: (subscription.totalEnquiries || 0) + (subscription.extraEnquiries || 0),
          expiresAt: subscription.expiryDate,
          daysLeft,
          isExpired,
          isLowCredits,
          planFeatures: subscription.planSnapshot?.features || {},
        },
        history: transactions.map(t => ({
          type: t.type,
          amount: t.amount,
          balanceAfter: t.balanceAfter,
          leadId: t.relatedLead,
          date: t.createdAt,
          description: t.description,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Membership ───────────────────────────────────────────────────────────────
router.get('/membership', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const [subscription, payments] = await Promise.all([
      Tutor.findById(req.userId).select('subscription').lean(),
      Payment.find({ user: req.userId, type: 'subscription' }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    res.json({
      success: true,
      data: { subscription: subscription?.subscription || null, payments },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Notifications  NOTE: read-all MUST come BEFORE :id/read  ────────────────
router.put('/notifications/read-all', auth, authorize('tutor'), async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipient: req.userId, recipientRole: 'tutor', isRead: false },
      { isRead: true, readAt: new Date() }
    );
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
});

router.get('/notifications', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const page  = Number(req.query.page  || 1);
    const limit = Number(req.query.limit || 20);

    const [notifications, total] = await Promise.all([
      Notification.find({ recipient: req.userId, recipientRole: 'tutor' })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments({ recipient: req.userId, recipientRole: 'tutor' }),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/notifications/:id/read', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.userId, recipientRole: 'tutor' },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    res.json({ success: true, data: { notification } });
  } catch (error) {
    next(error);
  }
});

// ─── Reviews ──────────────────────────────────────────────────────────────────
router.get('/reviews', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const reviews = await Review.find({ tutor: req.userId, isApproved: true })
      .populate('student', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: { reviews } });
  } catch (error) {
    next(error);
  }
});

router.post('/reviews/:id/reply', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const review = await Review.findOne({ _id: req.params.id, tutor: req.userId });
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    review.reply = { text: req.body.reply || '', repliedAt: new Date() };
    await review.save();
    res.json({ success: true, data: { review } });
  } catch (error) {
    next(error);
  }
});

// ─── Help / Support ───────────────────────────────────────────────────────────
router.post('/help', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const message = await ContactMessage.create({
      name: `${req.user.firstName} ${req.user.lastName}`,
      email: req.user.email,
      phone: req.user.phone,
      subject: req.body.subject || 'Tutor support request',
      message: req.body.message || '',
      source: 'tutor_dashboard',
    });

    if (req.io) req.io.to('admin_room').emit('contact_received', { message });
    res.status(201).json({ success: true, data: { message } });
  } catch (error) {
    next(error);
  }
});

// ─── Public tutor list ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const page  = Number(req.query.page  || 1);
    const limit = Math.min(Number(req.query.limit || 20), 50);
    const query = { isApproved: true, isActive: true };

    if (req.query.subject) query['subjects.name'] = new RegExp(req.query.subject, 'i');
    if (req.query.city) query.city = new RegExp(req.query.city, 'i');
    if (req.query.search) {
      query.$or = [
        { firstName: new RegExp(req.query.search, 'i') },
        { lastName:  new RegExp(req.query.search, 'i') },
        { headline:  new RegExp(req.query.search, 'i') },
        { bio:       new RegExp(req.query.search, 'i') },
        { 'subjects.name': new RegExp(req.query.search, 'i') },
      ];
    }

    const [tutors, total] = await Promise.all([
      Tutor.find(query)
        .sort({ isFeatured: -1, 'metrics.rankingScore': -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('-password -notifications')
        .lean(),
      Tutor.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        tutors: tutors.map(sanitizeTutor),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Public tutor profile (must be LAST — dynamic :id) ───────────────────────
router.get('/:id([0-9a-fA-F]{24})', async (req, res, next) => {
  try {
    const [tutor, reviews] = await Promise.all([
      Tutor.findOne({ _id: req.params.id, isApproved: true, isActive: true })
        .select('-password -notifications')
        .lean(),
      Review.find({ tutor: req.params.id, isApproved: true })
        .populate('student', 'firstName lastName')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    res.json({ success: true, data: { tutor: sanitizeTutor(tutor), reviews } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
