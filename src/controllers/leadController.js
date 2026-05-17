const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Tutor = require('../models/Tutor');
const TutorPlanSubscription = require('../models/TutorPlanSubscription');
const Notification = require('../models/Notification');
const logger = require('../utils/logger');

/**
 * UNLOCK LEAD FOR TUTOR
 * Deducts 1 enquiry from tutor's active plan
 * POST /api/tutors/leads/:leadId/unlock
 */
const unlockLead = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { leadId } = req.params;
    const tutorId = req.user._id;

    // Find lead
    const lead = await Lead.findById(leadId).session(session);
    if (!lead) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Lead not found',
      });
    }

    // Check lead is still active
    if (lead.status !== 'active') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Lead is ${lead.status}, cannot unlock`,
      });
    }

    // Find tutor's active subscription
    const subscription = await TutorPlanSubscription.findOne({
      tutor: tutorId,
      status: 'active',
      expiryDate: { $gt: new Date() },
    }).session(session);

    if (!subscription) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'No active plan. Please purchase a plan to unlock leads.',
      });
    }

    // Check remaining enquiries
    const remainingEnquiries = subscription.totalEnquiries +
      subscription.extraEnquiries -
      subscription.usedEnquiries;

    if (remainingEnquiries <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'No enquiries remaining. Please upgrade your plan.',
      });
    }

    // Check if tutor already unlocked this lead
    const alreadyUnlocked = lead.lockedBy.some(
      (lock) => lock.tutor.toString() === tutorId.toString()
    );

    if (alreadyUnlocked) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'You have already unlocked this lead',
      });
    }

    // Add tutor to lockedBy array
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48); // 48-hour lock

    lead.lockedBy.push({
      tutor: tutorId,
      unlockedAt: new Date(),
      expiresAt: expiresAt,
      enquiriesCost: 1,
      status: 'active',
    });

    await lead.save({ session });

    // Deduct enquiry from subscription
    subscription.usedEnquiries += 1;
    await subscription.save({ session });

    // Update tutor's subscription info
    const tutor = await Tutor.findByIdAndUpdate(
      tutorId,
      {
        $set: {
          'subscription.enquiriesUsed': subscription.usedEnquiries,
        },
      },
      { new: true, session }
    );

    // Create notification for tutor
    await Notification.create(
      [
        {
          recipient: tutorId,
          recipientRole: 'tutor',
          type: 'lead_assigned',
          title: '🎓 New Lead Unlocked!',
          message: `Lead for ${lead.requirements.subjects[0]} in ${lead.requirements.city} from ${lead.student.name}`,
          data: {
            leadId: lead._id,
            studentName: lead.student.name,
            subject: lead.requirements.subjects[0],
            city: lead.requirements.city,
          },
          channels: { inApp: true, email: true },
        },
      ],
      { session }
    );

    await session.commitTransaction();

    // Emit socket event for real-time update
    if (req.io) {
      req.io.to(`tutor_${tutorId}`).emit('lead_unlocked', {
        leadId: lead._id,
        studentName: lead.student.name,
        studentPhone: lead.student.phone,
        studentEmail: lead.student.email,
        subject: lead.requirements.subjects[0],
        city: lead.requirements.city,
        mode: lead.requirements.mode,
        budget: lead.requirements.budget,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Lead unlocked successfully!',
      data: {
        leadId: lead._id,
        studentName: lead.student.name,
        studentPhone: lead.student.phone,
        studentEmail: lead.student.email,
        subject: lead.requirements.subjects[0],
        city: lead.requirements.city,
        budget: lead.requirements.budget,
        enquiriesRemaining: remainingEnquiries - 1,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('Lead unlock failed:', error);
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * GET AVAILABLE LEADS FOR TUTOR
 * Shows leads matching tutor's city and subjects
 * Platinum/Diamond see all immediately, Silver/Gold see after 15 min
 */
const getAvailableLeads = async (req, res, next) => {
  try {
    const tutorId = req.user._id;
    const { page = 1, limit = 10, subject, city, mode } = req.query;

    // Get tutor profile
    const tutor = await Tutor.findById(tutorId);
    if (!tutor || !tutor.isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Your profile is not approved yet',
      });
    }

    // Get tutor's active subscription
    const subscription = await TutorPlanSubscription.findOne({
      tutor: tutorId,
      status: 'active',
      expiryDate: { $gt: new Date() },
    });

    const hasAdvanceAccess = subscription?.planSnapshot?.features?.advanceAlerts;

    // Build query
    const query = {
      status: 'active',
      'requirements.city': tutor.city,
    };

    // Add filters
    if (subject) {
      query['requirements.subjects'] = subject;
    }
    if (mode) {
      query['requirements.mode'] = mode;
    }

    // For advance alert logic
    if (!hasAdvanceAccess) {
      // Silver/Gold: only show leads after 15 min release time
      query.$or = [
        { advanceReleaseAt: { $exists: false } },
        { advanceReleaseAt: { $lte: new Date() } },
      ];
    }

    // Exclude leads already unlocked by this tutor
    const leads = await Lead.find(query)
      .select({
        'student.phone': 0,
        'student.email': 0,
        'requirements.specialRequirements': 0,
      })
      .populate('lockedBy.tutor', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Filter out leads already unlocked by tutor
    const filtered = leads.filter(
      (lead) => !lead.lockedBy.some((lock) => lock.tutor._id.toString() === tutorId.toString())
    );

    const total = await Lead.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        leads: filtered.map((lead) => ({
          ...lead.toObject(),
          student: {
            name: lead.student.name,
            // Phone and email blurred until unlocked
          },
          hasAdvanceAccess,
        })),
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Get available leads failed:', error);
    next(error);
  }
};

/**
 * GET TUTOR'S UNLOCKED LEADS
 */
const getUnlockedLeads = async (req, res, next) => {
  try {
    const tutorId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;

    const query = {
      'lockedBy.tutor': tutorId,
    };

    if (status) {
      query['lockedBy.status'] = status;
    }

    const leads = await Lead.find(query)
      .populate('lockedBy.tutor', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Lead.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        leads: leads.map((lead) => ({
          ...lead.toObject(),
          tumorLock: lead.lockedBy.find((lock) => lock.tutor._id.toString() === tutorId.toString()),
        })),
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  unlockLead,
  getAvailableLeads,
  getUnlockedLeads,
};
