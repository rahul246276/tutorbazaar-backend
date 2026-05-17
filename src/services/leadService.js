const mongoose = require('mongoose');
const crypto = require('crypto');
const Lead = require('../models/Lead');
const SiteSettings = require('../models/SiteSettings');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const { sendToTutor } = require('./notificationService');
const { getActiveSubscription, useEnquiry } = require('./planService');

const getSettings = async () => {
  let settings = await SiteSettings.findById('main');
  if (!settings) {
    settings = await SiteSettings.create({ _id: 'main' });
  }
  return settings;
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSubjects = (subjects, fallback = 'General Tutoring') => {
  const rawSubjects = Array.isArray(subjects) ? subjects : [subjects].filter(Boolean);
  const normalized = rawSubjects
    .map((subject) => (typeof subject === 'string' ? subject : subject?.name))
    .map((subject) => String(subject || '').trim())
    .filter(Boolean);

  return Array.from(new Set(normalized.length ? normalized : [fallback]));
};

const normalizeBudget = (budget = {}) => {
  if (typeof budget === 'number' || typeof budget === 'string') {
    const amount = Number(budget) || 0;
    return { min: amount, max: amount };
  }

  return {
    min: Number(budget.min || 0),
    max: Number(budget.max || budget.min || 0),
  };
};

const normalizeCoordinates = (coordinates = {}) => {
  const lat = Number(coordinates.lat ?? coordinates.latitude);
  const lng = Number(coordinates.lng ?? coordinates.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }

  return { lat, lng };
};

const getFullName = (student) =>
  [student?.firstName, student?.lastName].filter(Boolean).join(' ').trim() || student?.email || 'Student';

const normalizeTutorMatch = (tutor, lead) => {
  const tutorSubjects = (tutor.subjects || []).map((subject) => subject.name?.toLowerCase());
  const leadSubjects = (lead.requirements.subjects || []).map((subject) => subject.toLowerCase());
  const sharedSubjects = leadSubjects.filter((subject) => tutorSubjects.includes(subject)).length;
  const sameCity = tutor.city?.toLowerCase() === lead.requirements.city?.toLowerCase();
  return {
    sameCity,
    sharedSubjects,
    isMatch: sharedSubjects > 0 && sameCity && tutor.isApproved && tutor.isActive,
  };
};

const notifyMatchingTutors = async (lead) => {
  const tutors = await Tutor.find({
    isApproved: true,
    isActive: true,
    city: new RegExp(`^${escapeRegex(lead.requirements.city)}$`, 'i'),
  }).select('email city subjects subscription');

  const premiumTutors = tutors.filter((tutor) => {
    const match = normalizeTutorMatch(tutor, lead);
    return match.isMatch && ['platinum', 'diamond'].includes(tutor.subscription?.currentPlanName);
  });

  await Promise.all(
    premiumTutors.map((tutor) =>
      sendToTutor(tutor._id, {
        type: 'new_lead',
        title: 'New lead available',
        message: `${lead.requirements.subjects[0]} lead available in ${lead.requirements.city}`,
        data: { leadId: lead._id, subject: lead.requirements.subjects[0], city: lead.requirements.city },
        channels: { inApp: true, email: false, sms: false },
      })
    )
  );
};

const createLeadFromEnquiry = async (payload, io = null) => {
  const settings = await getSettings();
  const subjects = normalizeSubjects(payload.subjects || payload.subject || payload.courseInterest);
  const budget = normalizeBudget(payload.budget);
  const coordinates = normalizeCoordinates(payload.coordinates || payload.location?.coordinates);
  const email = String(payload.email || '').trim().toLowerCase();
  let student = payload.studentId ? await Student.findById(payload.studentId) : null;

  if (!student && email) {
    student = await Student.findOne({ email });
  }

  if (!student) {
    student = await Student.create({
      email,
      password: crypto.randomBytes(12).toString('hex'),
      role: 'student',
      firstName: payload.firstName,
      lastName: payload.lastName,
      phone: payload.phone,
      city: payload.city || 'Unknown',
      locality: payload.locality || '',
      area: payload.area || payload.locality || '',
      state: payload.state || '',
      coordinates,
      class: payload.class || 'Other',
      board: payload.board || 'Other',
      subjects: subjects.map((name) => ({ name })),
      preferences: {
        mode: payload.mode || 'both',
        budget,
      },
      source: payload.source || 'website_enquiry',
      ipAddress: payload.ipAddress || '',
    });
  } else {
    const studentUpdates = {
      phone: payload.phone || student.phone,
      city: payload.city || student.city || 'Unknown',
      locality: payload.locality ?? student.locality,
      area: payload.area || payload.locality || student.area,
      state: payload.state ?? student.state,
      class: payload.class || student.class || 'Other',
      board: payload.board || student.board || 'Other',
      subjects: subjects.map((name) => ({ name })),
      preferences: {
        ...(student.preferences?.toObject ? student.preferences.toObject() : student.preferences || {}),
        mode: payload.mode || student.preferences?.mode || 'both',
        budget: Object.keys(budget).length ? budget : student.preferences?.budget || {},
      },
      source: student.source || payload.source || 'website_enquiry',
      ipAddress: payload.ipAddress || student.ipAddress,
      status: student.status || 'active',
    };

    if (coordinates) studentUpdates.coordinates = coordinates;
    Object.assign(student, studentUpdates);
    await student.save();
  }

  const advanceReleaseAt = new Date(Date.now() + (settings.leadSettings.advanceAlertMinutes || 15) * 60 * 1000);
  const lead = await Lead.create({
    student: {
      id: student._id,
      name: getFullName(student),
      phone: student.phone,
      email: student.email,
      whatsapp: payload.whatsapp || student.phone,
    },
    requirements: {
      class: payload.class || student.class || 'Other',
      subjects,
      board: payload.board || student.board || 'Other',
      mode: payload.mode || student.preferences?.mode || 'both',
      city: payload.city || student.city || 'Unknown',
      locality: payload.locality || '',
      area: payload.area || payload.locality || '',
      state: payload.state || student.state || '',
      coordinates,
      budget,
      preferredTiming: payload.preferredTiming || '',
      startDate: payload.startDate || null,
      goals: payload.goals || '',
      specialRequirements: payload.specialRequirements || '',
    },
    advanceReleaseAt,
    expiresAt: new Date(Date.now() + (settings.leadSettings.leadExpiryHours || 48) * 60 * 60 * 1000),
    isManual: Boolean(payload.isManual),
    source: payload.source || 'website_enquiry',
    ipAddress: payload.ipAddress || '',
  });

  await Student.findByIdAndUpdate(student._id, { $addToSet: { enquiries: lead._id } });

  if (io) {
    io.to('admin_room').emit('new_lead_created', {
      lead: { _id: lead._id, leadId: lead.leadId, subject: lead.requirements.subjects[0], city: lead.requirements.city },
      student: { _id: student._id, name: getFullName(student) },
    });
  }

  await notifyMatchingTutors(lead);

  return { lead, student };
};

const createLeadFromRegisteredStudent = async (student, payload = {}, io = null) =>
  createLeadFromEnquiry(
    {
      ...payload,
      studentId: student._id,
      email: student.email,
      firstName: student.firstName,
      lastName: student.lastName,
      phone: student.phone,
      city: payload.city || student.city,
      locality: payload.locality || student.locality || '',
      area: payload.area || student.area || student.locality || '',
      state: payload.state || student.state || '',
      coordinates: payload.coordinates || student.coordinates,
      class: payload.class || student.class,
      board: payload.board || student.board || 'Other',
      subjects: payload.subjects || payload.subject || student.subjects,
      mode: payload.mode || student.preferences?.mode || 'both',
      budget: payload.budget || student.preferences?.budget || {},
      source: payload.source || 'student_registration',
      ipAddress: payload.ipAddress || student.ipAddress || '',
      specialRequirements: payload.specialRequirements || 'Registered student requirement',
    },
    io
  );

const assignLeadToTutors = async (leadId, tutorIds = [], options = {}) => {
  const {
    adminId = null,
    reason = 'Assigned by admin',
    message = '',
    io = null,
    notify = true,
  } = options;

  const uniqueTutorIds = Array.from(new Set((tutorIds || []).map(String).filter(Boolean)));
  if (!uniqueTutorIds.length) {
    throw new Error('At least one tutor is required');
  }

  const lead = await Lead.findById(leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const tutors = await Tutor.find({ _id: { $in: uniqueTutorIds }, isActive: true });
  const distributed = [];
  const errors = [];
  const expiresAt = lead.expiresAt || new Date(Date.now() + 48 * 60 * 60 * 1000);

  for (const tutorId of uniqueTutorIds) {
    const tutor = tutors.find((item) => item._id.toString() === tutorId);
    if (!tutor) {
      errors.push(`Tutor ${tutorId} not found or inactive`);
      continue;
    }

    const alreadyAssigned = (lead.lockedBy || []).some((lock) => lock.tutor?.toString() === tutorId);
    if (alreadyAssigned) {
      errors.push(`Lead already assigned to ${tutor.firstName} ${tutor.lastName}`);
      continue;
    }

    lead.lockedBy.push({
      tutor: tutor._id,
      unlockedAt: new Date(),
      expiresAt,
      enquiriesCost: 0,
      adminAssigned: true,
      assignedAt: new Date(),
      status: 'new',
    });

    if (!lead.lockInfo?.tutor) {
      lead.lockInfo = {
        tutor: tutor._id,
        lockedAt: new Date(),
        expiresAt,
        creditsDeducted: 0,
        unlockCount: lead.lockInfo?.unlockCount || 0,
      };
    }

    tutor.metrics = tutor.metrics || {};
    tutor.metrics.unlockedLeads = (tutor.metrics.unlockedLeads || 0) + 1;
    tutor.metrics.totalLeads = (tutor.metrics.totalLeads || 0) + 1;
    await tutor.save({ validateBeforeSave: false });

    distributed.push({
      tutorId: tutor._id,
      tutorName: `${tutor.firstName} ${tutor.lastName}`,
      email: tutor.email,
      planName: tutor.subscription?.currentPlanName || 'none',
    });
  }

  if (distributed.length) {
    const assignedIds = Array.from(new Set([
      ...((lead.adminAssigned?.tutorIds || []).map(String)),
      ...distributed.map((item) => String(item.tutorId)),
    ]));

    lead.status = 'locked';
    lead.adminAssigned = {
      isAssigned: true,
      tutorIds: assignedIds.map((id) => new mongoose.Types.ObjectId(id)),
      assignedBy: adminId,
      assignedAt: new Date(),
      reason,
    };

    await lead.save();

    if (notify) {
      await Promise.all(distributed.map((item) =>
        sendToTutor(item.tutorId, {
          type: 'lead_assigned',
          title: 'Lead assigned by admin',
          message: message || `${lead.requirements.subjects?.[0] || 'Student'} lead in ${lead.requirements.city} has been assigned to you.`,
          data: { leadId: lead._id, leadPublicId: lead.leadId, city: lead.requirements.city },
          actionUrl: '/tutor/leads',
          channels: { inApp: true, email: Boolean(item.email), sms: false },
          emailTo: item.email,
        })
      ));
    }

    if (io) {
      distributed.forEach((item) => {
        io.to(`tutor_${item.tutorId}`).emit('lead_assigned', {
          lead,
          studentDetails: lead.student,
          message: message || 'Admin has assigned you a new student lead',
        });
      });
      io.to('admin_room').emit('lead_assignment_updated', { leadId: lead._id, tutorIds: distributed.map((item) => item.tutorId) });
    }
  }

  return {
    lead: lead.toObject(),
    distributed: distributed.length,
    notified: notify ? distributed.length : 0,
    errors,
    tutors: distributed,
  };
};

const getAvailableLeadsForTutor = async (tutorId, filters = {}) => {
  const tutor = await Tutor.findById(tutorId);
  if (!tutor) {
    throw new Error('Tutor not found');
  }

  const subscription = await getActiveSubscription(tutorId);
  
  // If no active subscription, return "Get Plan" wall
  if (!subscription) {
    return {
      leads: [],
      hasPlan: false,
      message: "Buy a plan to view leads",
      pagination: { page: 1, limit: 10, total: 0, pages: 0 },
      subscription: null,
    };
  }

  const premium = ['platinum', 'diamond'].includes(subscription.plan);
  const page = Number(filters.page || 1);
  const limit = Number(filters.limit || 10);

  const query = {
    status: 'active',
  };

  // Add city filter if available
  if (filters.city || tutor.city) {
    query['requirements.city'] = new RegExp(escapeRegex(filters.city || tutor.city), 'i');
  }

  // Add subjects filter
  if (filters.subject) {
    query['requirements.subjects'] = { $in: [filters.subject] };
  } else if (tutor.subjects?.length > 0) {
    query['requirements.subjects'] = { $in: tutor.subjects.map((subject) => subject.name) };
  }

  // Add mode filter
  if (filters.mode) {
    query['requirements.mode'] = filters.mode;
  }

  // Apply advance release filter for Silver/Gold plans
  if (!premium) {
    query.$or = [
      { advanceReleaseAt: { $exists: false } },
      { advanceReleaseAt: { $lte: new Date() } },
    ];
  }

  const [leads, total] = await Promise.all([
    Lead.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Lead.countDocuments(query),
  ]);

  const filtered = leads
    .filter((lead) => !(lead.lockedBy || []).some((lock) => lock.tutor?.toString() === tutorId.toString()))
    .map((lead) => {
      // Calculate hours ago
      const hoursAgo = Math.floor((new Date() - new Date(lead.createdAt)) / (1000 * 60 * 60));
      
      // Create blurred student preview
      const studentName = lead.student?.name || '';
      const studentPhone = lead.student?.phone || '';
      const studentPreview = studentName.length > 2 
        ? studentName.substring(0, 2) + '** ' + studentName.split(' ').map(part => 
            part.length > 0 ? part[0] + '*' : ''
          ).join(' ')
        : '**';
      const phonePreview = studentPhone.length >= 4 
        ? studentPhone.substring(0, 2) + '****' + studentPhone.substring(studentPhone.length - 2)
        : '****';

      return {
        ...lead,
        student: {
          ...lead.student,
          name: studentPreview,
          phone: phonePreview,
          email: undefined,
        },
        hasAdvanceAccess: premium,
        hoursAgo,
        studentPreview,
        phonePreview,
      };
    });

  return {
    leads: filtered,
    hasPlan: true,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    subscription,
  };
};

const getUnlockedLeadsForTutor = async (tutorId, filters = {}) => {
  const page = Number(filters.page || 1);
  const limit = Number(filters.limit || 10);
  const query = { 'lockedBy.tutor': tutorId };

  if (filters.status) {
    query['lockedBy.status'] = filters.status;
  }

  const [leads, total] = await Promise.all([
    Lead.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Lead.countDocuments(query),
  ]);

  return {
    leads: leads.map((lead) => ({
      ...lead,
      tutorLock: (lead.lockedBy || []).find((lock) => lock.tutor?.toString() === tutorId.toString()),
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

const unlockLeadForTutor = async (tutorId, leadId, io = null) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const lead = await Lead.findById(leadId).session(session);
    if (!lead) {
      throw new Error('Lead not found');
    }
    if (lead.status !== 'active') {
      throw new Error(`Lead is ${lead.status}`);
    }
    if ((lead.lockedBy || []).some((lock) => lock.tutor?.toString() === tutorId.toString())) {
      throw new Error('Lead already unlocked by this tutor');
    }

    const subscription = await useEnquiry(tutorId, lead._id, session);
    lead.lockedBy.push({
      tutor: tutorId,
      unlockedAt: new Date(),
      expiresAt: lead.expiresAt,
      enquiriesCost: 1,
      status: 'new',
    });
    lead.lockInfo = {
      tutor: tutorId,
      lockedAt: new Date(),
      expiresAt: lead.expiresAt,
      creditsDeducted: 1,
      unlockCount: (lead.lockInfo?.unlockCount || 0) + 1,
    };
    lead.status = 'locked';
    await lead.save({ session });

    await session.commitTransaction();
    session.endSession();

    if (io) {
      io.to('admin_room').emit('tutor_unlocked_lead', { tutorId, leadId: lead._id });
    }

    // Return full student contact information after unlock
    const studentContact = {
      name: lead.student?.name || '',
      phone: lead.student?.phone || '',
      email: lead.student?.email || '',
      whatsapp: lead.student?.whatsapp || lead.student?.phone || '',
      city: lead.requirements?.city || '',
      locality: lead.requirements?.locality || '',
      goals: lead.requirements?.goals || '',
      mode: lead.requirements?.mode || '',
      budget: lead.requirements?.budget || {},
    };

    return { 
      lead, 
      enquiriesRemaining: subscription.remainingEnquiries, 
      student: studentContact,
      unlockedAt: new Date(),
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const updateTutorLeadStatus = async (tutorId, leadId, status) => {
  const lead = await Lead.findById(leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const lock = lead.lockedBy.find((item) => item.tutor?.toString() === tutorId.toString());
  if (!lock) {
    throw new Error('Lead not unlocked by tutor');
  }

  lock.status = status;
  if (status === 'converted') {
    lead.status = 'converted';
    lead.conversion = { convertedAt: new Date(), convertedBy: tutorId };
  }

  await lead.save();
  return lead;
};

const addTutorLeadNote = async (tutorId, leadId, note) => {
  const lead = await Lead.findById(leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const lock = lead.lockedBy.find((item) => item.tutor?.toString() === tutorId.toString());
  if (!lock) {
    throw new Error('Lead not unlocked by tutor');
  }

  lock.notes = note;
  await lead.save();
  return lead;
};

module.exports = {
  createLeadFromEnquiry,
  createLeadFromRegisteredStudent,
  assignLeadToTutors,
  getAvailableLeadsForTutor,
  getUnlockedLeadsForTutor,
  unlockLeadForTutor,
  updateTutorLeadStatus,
  addTutorLeadNote,
  getSettings,
};
