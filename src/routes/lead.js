const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const Lead = require('../models/Lead');
const { unlockLeadForTutor, updateTutorLeadStatus } = require('../services/leadService');

const router = express.Router();

router.get('/search', auth, authorize('admin'), async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.city) filter['requirements.city'] = new RegExp(req.query.city, 'i');
    if (req.query.subject) filter['requirements.subjects'] = new RegExp(req.query.subject, 'i');
    const [leads, total] = await Promise.all([
      Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Lead.countDocuments(filter),
    ]);
    res.json({ success: true, data: { leads, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', auth, authorize('admin'), async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, data: { lead } });
  } catch (error) {
    next(error);
  }
});

router.put('/:id/status', auth, authorize('admin'), async (req, res, next) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, { status: req.body.status, adminNotes: req.body.notes || '' }, { new: true });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, data: { lead } });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/redistribute', auth, authorize('admin'), async (req, res, next) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, { status: 'active' }, { new: true });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, data: { lead } });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/unlock', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const result = await unlockLeadForTutor(req.userId, req.params.id, req.io);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/contacted', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const lead = await updateTutorLeadStatus(req.userId, req.params.id, 'contacted');
    res.json({ success: true, data: { lead } });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/converted', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const lead = await updateTutorLeadStatus(req.userId, req.params.id, 'converted');
    res.json({ success: true, data: { lead } });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/not-interested', auth, authorize('tutor'), async (req, res, next) => {
  try {
    const lead = await updateTutorLeadStatus(req.userId, req.params.id, 'lost');
    res.json({ success: true, data: { lead } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
