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

const hasAllSubjects = (subjects = []) =>
  subjects.some((subject) => String(subject || '').trim().toLowerCase() === 'all subjects');

const getTutorSubjectNames = (tutor) =>
  (tutor.subjects || [])
    .map((subject) => (typeof subject === 'string' ? subject : subject?.name))
    .map((subject) => String(subject || '').trim())
    .filter(Boolean);

const getTutorTeachingModes = (tutor) => {
  const modes = Array.isArray(tutor.teachingModes) ? tutor.teachingModes : [];
  const normalized = modes.map((mode) => String(mode || '').toLowerCase());
  if (normalized.includes('both') || normalized.length === 0) return ['online', 'offline'];
  return normalized.filter((mode) => ['online', 'offline'].includes(mode));
};

const buildTutorLeadQuery = (tutor, filters = {}) => {
  const tutorModes = getTutorTeachingModes(tutor);
  const tutorSubjects = getTutorSubjectNames(tutor);
  const subjectFilter = String(filters.subject || '').trim();
  const cityFilter = String(filters.city || '').trim();
  const modeFilter = String(filters.mode || '').trim().toLowerCase();
  const city = cityFilter || tutor.city || '';

  const query = { status: 'active' };
  const and = [];

  const subjectOptions = [];
  if (subjectFilter) {
    subjectOptions.push({ 'requirements.subjects': new RegExp(`^${escapeRegex(subjectFilter)}$`, 'i') });
    if (subjectFilter.toLowerCase() !== 'all subjects') {
      subjectOptions.push({ 'requirements.subjects': /^All Subjects$/i });
    }
  } else if (!hasAllSubjects(tutorSubjects) && tutorSubjects.length > 0) {
    subjectOptions.push({ 'requirements.subjects': { $in: tutorSubjects } });
    subjectOptions.push({ 'requirements.subjects': /^All Subjects$/i });
  }
  if (subjectOptions.length) and.push({ $or: subjectOptions });

  const modeOptions = [];
  const requestedModes = modeFilter && modeFilter !== 'both' ? [modeFilter] : tutorModes;
  if (requestedModes.includes('online')) {
    modeOptions.push({ 'requirements.mode': { $in: ['online', 'both'] } });
  }
  if (requestedModes.includes('offline') && city) {
    modeOptions.push({
      'requirements.mode': { $in: ['offline', 'both'] },
      'requirements.city': new RegExp(`^${escapeRegex(city)}$`, 'i'),
    });
  }
  if (modeOptions.length) and.push({ $or: modeOptions });

  if (and.length) query.$and = and;
  return query;
};

const isLeadAssignedToTutor = (lead, tutorId) =>
  (lead.adminAssigned?.tutorIds || []).some((id) => id?.toString() === tutorId.toString()) ||
  (lead.lockedBy || []).some((lock) =>
    lock.tutor?.toString() === tutorId.toString() && lock.adminAssigned
  );

const hasTutorViewedLead = (lead, tutorId) =>
  (lead.viewedBy || []).some((view) => view.tutor?.toString() === tutorId.toString()) ||
  (lead.lockedBy || []).some((lock) =>
    lock.tutor?.toString() === tutorId.toString() && !lock.adminAssigned
  );

const sanitizeLeadForTutor = (lead, tutorId, { revealContact = false, premium = false } = {}) => {
  const viewed = revealContact || hasTutorViewedLead(lead, tutorId);
  const student = lead.student || {};
  const studentName = student.name || '';
  const studentPhone = student.phone || '';
  const maskedName = studentName.length > 2
    ? `${studentName.substring(0, 2)}**`
    : 'Student';
  const maskedPhone = studentPhone.length >= 4
    ? `${studentPhone.substring(0, 2)}****${studentPhone.substring(studentPhone.length - 2)}`
    : 'Click View to see contact details';

  return {
    ...lead,
    student: viewed
      ? student
      : {
          id: student.id,
          name: maskedName,
          phone: undefined,
          email: undefined,
          whatsapp: undefined,
          contactLocked: true,
          contactMessage: 'Click View to see contact details',
          phonePreview: maskedPhone,
        },
    isViewedByTutor: viewed,
    contactLocked: !viewed,
    isAdminAssignedToTutor: isLeadAssignedToTutor(lead, tutorId),
    hasAdvanceAccess: premium,
  };
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
  const tutorSubjects = getTutorSubjectNames(tutor).map((subject) => subject.toLowerCase());
  const leadSubjects = (lead.requirements.subjects || []).map((subject) => subject.toLowerCase());
  const sharedSubjects = hasAllSubjects(leadSubjects) || hasAllSubjects(tutorSubjects)
    ? Math.max(leadSubjects.length, 1)
    : leadSubjects.filter((subject) => tutorSubjects.includes(subject)).length;
  const sameCity = tutor.city?.toLowerCase() === lead.requirements.city?.toLowerCase();
  const modes = getTutorTeachingModes(tutor);
  const onlineMatch = modes.includes('online') && ['online', 'both'].includes(lead.requirements.mode);
  const offlineMatch = modes.includes('offline') && ['offline', 'both'].includes(lead.requirements.mode) && sameCity;
  return {
    sameCity,
    sharedSubjects,
    isMatch: sharedSubjects > 0 && (onlineMatch || offlineMatch) && tutor.isApproved && tutor.isActive,
  };
};

const notifyMatchingTutors = async (lead) => {
  const tutors = await Tutor.find({ isApproved: true, isActive: true })
    .select('email city subjects teachingModes subscription');

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

  for (const tutorId of uniqueTutorIds) {
    const tutor = tutors.find((item) => item._id.toString() === tutorId);
    if (!tutor) {
      errors.push(`Tutor ${tutorId} not found or inactive`);
      continue;
    }

    const alreadyAssigned = isLeadAssignedToTutor(lead, tutorId);
    if (alreadyAssigned) {
      errors.push(`Lead already assigned to ${tutor.firstName} ${tutor.lastName}`);
      continue;
    }

    tutor.metrics = tutor.metrics || {};
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
          lead: sanitizeLeadForTutor(lead.toObject(), item.tutorId),
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

  const marketplaceQuery = buildTutorLeadQuery(tutor, filters);
  marketplaceQuery['lockedBy.tutor'] = { $ne: tutorId };

  // Apply advance release filter for Silver/Gold plans
  if (!premium) {
    marketplaceQuery.$and = [
      ...(marketplaceQuery.$and || []),
      {
        $or: [
          { advanceReleaseAt: { $exists: false } },
          { advanceReleaseAt: { $lte: new Date() } },
        ],
      },
    ];
  }

  // Admin-pushed leads stay available with hidden contact details until viewed.
  // The legacy lockedBy condition also restores already-assigned, unviewed leads.
  const assignedUnviewedQuery = {
    status: { $in: ['active', 'locked'] },
    'viewedBy.tutor': { $ne: tutorId },
    $or: [
      { 'adminAssigned.tutorIds': tutorId },
      { lockedBy: { $elemMatch: { tutor: tutorId, adminAssigned: true } } },
    ],
  };
  const query = { $or: [marketplaceQuery, assignedUnviewedQuery] };

  const [leads, total] = await Promise.all([
    Lead.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Lead.countDocuments(query),
  ]);

  const filtered = leads
    .map((lead) => {
      // Calculate hours ago
      const hoursAgo = Math.floor((new Date() - new Date(lead.createdAt)) / (1000 * 60 * 60));

      return {
        ...sanitizeLeadForTutor(lead, tutorId, { premium }),
        hoursAgo,
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
  const lockMatch = { tutor: tutorId };
  if (filters.status) lockMatch.status = filters.status;
  const query = {
    $and: [
      { lockedBy: { $elemMatch: lockMatch } },
      {
        $or: [
          { 'viewedBy.tutor': tutorId },
          { lockedBy: { $elemMatch: { tutor: tutorId, adminAssigned: { $ne: true } } } },
        ],
      },
    ],
  };

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
      ...sanitizeLeadForTutor(lead, tutorId, { revealContact: true }),
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
    const existingLock = (lead.lockedBy || []).find((lock) => lock.tutor?.toString() === tutorId.toString());
    const alreadyUnlocked = Boolean(existingLock);
    const adminAssigned = isLeadAssignedToTutor(lead, tutorId);
    if (lead.status !== 'active' && !adminAssigned && !alreadyUnlocked) {
      throw new Error(`Lead is ${lead.status}`);
    }

    let subscription = await getActiveSubscription(tutorId, session);
    if (!subscription) {
      throw new Error('No active subscription');
    }

    if (!alreadyUnlocked) {
      if (!adminAssigned) {
        subscription = await useEnquiry(tutorId, lead._id, session);
      }
      lead.lockedBy.push({
        tutor: tutorId,
        unlockedAt: new Date(),
        expiresAt: lead.expiresAt,
        enquiriesCost: adminAssigned ? 0 : 1,
        adminAssigned,
        assignedAt: adminAssigned ? lead.adminAssigned?.assignedAt || new Date() : undefined,
        status: 'new',
      });
      lead.lockInfo = {
        tutor: tutorId,
        lockedAt: new Date(),
        expiresAt: lead.expiresAt,
        creditsDeducted: adminAssigned ? 0 : 1,
        unlockCount: (lead.lockInfo?.unlockCount || 0) + 1,
      };
    }

    const alreadyViewed = (lead.viewedBy || []).some((view) => view.tutor?.toString() === tutorId.toString());
    if (!alreadyViewed) {
      lead.viewedBy.push({ tutor: tutorId, viewedAt: new Date() });
      await Tutor.updateOne(
        { _id: tutorId },
        {
          $inc: {
            'metrics.enquiriesViewed': 1,
            ...(!alreadyUnlocked ? { 'metrics.unlockedLeads': 1, 'metrics.totalLeads': 1 } : {}),
          },
        },
        { session }
      );
    }

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
      lead: sanitizeLeadForTutor(lead.toObject(), tutorId, { revealContact: true }),
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
  buildTutorLeadQuery,
};
