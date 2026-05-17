const express = require('express');
const crypto = require('crypto');
const Student = require('../models/Student');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { logActivity } = require('../middleware/activityLog');
const { assignLeadToTutors, createLeadFromEnquiry } = require('../services/leadService');

const router = express.Router();

const parsePagination = (query) => {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const normalizeSubjects = (subjects, subject) => {
  const values = Array.isArray(subjects) ? subjects : [subject || subjects].filter(Boolean);
  const names = values
    .map((value) => (typeof value === 'string' ? value : value?.name))
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return names.length ? names : ['General Tutoring'];
};

const formatLeadForStudent = (lead = {}) => ({
  ...lead,
  _id: lead._id,
  subject: (lead.requirements?.subjects || []).join(', '),
  class: lead.requirements?.class || '',
  city: lead.requirements?.city || '',
  locality: lead.requirements?.locality || '',
  area: lead.requirements?.area || lead.requirements?.locality || '',
  state: lead.requirements?.state || '',
  budget: lead.requirements?.budget || {},
  specialRequirements: lead.requirements?.specialRequirements || '',
});

const formatStudent = (student = {}) => ({
  ...student,
  status: student.status || (student.isActive === false ? 'blocked' : 'active'),
  enquiries: (student.enquiries || []).map(formatLeadForStudent),
});

router.get('/students', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.city && req.query.city !== 'all') filter.city = new RegExp(req.query.city, 'i');
    if (req.query.class && req.query.class !== 'all') filter.class = req.query.class;
    if (req.query.status && req.query.status !== 'all') {
      if (req.query.status === 'active') {
        filter.isActive = { $ne: false };
        filter.status = { $ne: 'blocked' };
      } else if (req.query.status === 'blocked') {
        filter.$or = [{ isActive: false }, { status: 'blocked' }];
      } else {
        filter.status = req.query.status;
      }
    }
    if (req.query.hasEnquiries === 'with') filter['enquiries.0'] = { $exists: true };
    if (req.query.hasEnquiries === 'without') filter.enquiries = { $size: 0 };
    if (req.query.search) {
      const searchFilter = [
        { firstName: new RegExp(req.query.search, 'i') },
        { lastName: new RegExp(req.query.search, 'i') },
        { email: new RegExp(req.query.search, 'i') },
        { phone: new RegExp(req.query.search, 'i') },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchFilter }];
        delete filter.$or;
      } else {
        filter.$or = searchFilter;
      }
    }
    const [students, total] = await Promise.all([
      Student.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: 'enquiries', options: { sort: { createdAt: -1 } } })
        .lean(),
      Student.countDocuments(filter),
    ]);

    const [totalEnquiries, assignedEnquiries, convertedEnquiries] = await Promise.all([
      Lead.countDocuments({}),
      Lead.countDocuments({ 'lockedBy.0': { $exists: true } }),
      Lead.countDocuments({ status: 'converted' }),
    ]);

    res.json({
      success: true,
      data: students.map(formatStudent),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      stats: {
        totalStudents: total,
        totalEnquiries,
        distributionRate: totalEnquiries ? Math.round((assignedEnquiries / totalEnquiries) * 100) : 0,
        conversionRate: totalEnquiries ? Math.round((convertedEnquiries / totalEnquiries) * 100) : 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/students/:id', async (req, res, next) => {
  try {
    const student = await Student.findById(req.params.id).lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    const enquiries = await Lead.find({ 'student.id': req.params.id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: { student: formatStudent({ ...student, enquiries }), enquiries: enquiries.map(formatLeadForStudent) } });
  } catch (error) {
    next(error);
  }
});

router.post('/students/:id/distribute-enquiry', async (req, res, next) => {
  try {
    if (!req.body.leadId || !req.body.tutorId) {
      return res.status(400).json({ success: false, message: 'leadId and tutorId are required' });
    }

    const lead = await Lead.findOne({ _id: req.body.leadId, 'student.id': req.params.id });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found for this student' });

    const result = await assignLeadToTutors(req.body.leadId, [req.body.tutorId], {
      adminId: req.userId,
      reason: req.body.reason || 'Distributed from student profile',
      io: req.io,
    });
    await logActivity(req, 'assign_lead', 'lead', lead._id, lead.leadId, { tutorId: req.body.tutorId });
    res.json({ success: true, data: result.lead });
  } catch (error) {
    next(error);
  }
});

router.put('/students/:id/block', async (req, res, next) => {
  try {
    const student = await Student.findByIdAndUpdate(req.params.id, { isActive: false, status: 'blocked' }, { new: true });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    await logActivity(req, 'block_student', 'student', student._id, `${student.firstName} ${student.lastName}`);
    res.json({ success: true, data: student });
  } catch (error) {
    next(error);
  }
});

router.delete('/students/:id', async (req, res, next) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    await Lead.deleteMany({ 'student.id': req.params.id });
    res.json({ success: true, message: 'Student deleted' });
  } catch (error) {
    next(error);
  }
});

// Create student endpoint
router.post('/students', async (req, res, next) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      city,
      locality,
      status = 'active',
      board = 'Other',
      budget = {},
      mode = 'both'
    } = req.body;
    const className = req.body.class || req.body.grade || 'Other';
    const subjects = normalizeSubjects(req.body.subjects, req.body.subject);

    // Validate required fields
    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ success: false, message: 'Required fields are missing' });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const student = new Student({
      firstName,
      lastName,
      email,
      password: req.body.password || crypto.randomBytes(12).toString('hex'),
      role: 'student',
      phone,
      city: city || 'Unknown',
      locality: locality || '',
      area: req.body.area || locality || '',
      state: req.body.state || '',
      class: className,
      board,
      subjects: subjects.map((name) => ({ name })),
      preferences: {
        mode,
        budget,
      },
      status,
      isActive: status !== 'blocked',
      source: 'admin_created',
      ipAddress: req.ip,
    });
    await student.save();

    let lead = null;
    if (req.body.createLead !== false) {
      const result = await createLeadFromEnquiry({
        studentId: student._id,
        firstName,
        lastName,
        email,
        phone,
        city: city || 'Unknown',
        locality: locality || '',
        area: req.body.area || locality || '',
        state: req.body.state || '',
        class: className,
        board,
        subjects,
        mode,
        budget,
        specialRequirements: req.body.specialRequirements || 'Admin-created student requirement',
        source: 'admin_student',
        ipAddress: req.ip,
        isManual: true,
      }, req.io);
      lead = result.lead;
    }

    await logActivity(req, 'create_student', 'student', student._id, `${firstName} ${lastName}`, req.body);

    res.status(201).json({ 
      success: true, 
      message: 'Student created successfully', 
      data: formatStudent({ ...student.toObject(), enquiries: lead ? [lead.toObject()] : [] }),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
