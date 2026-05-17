const express = require('express');
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Tutor = require('../models/Tutor');
const { logActivity } = require('../middleware/activityLog');
const { assignLeadToTutors, createLeadFromEnquiry } = require('../services/leadService');
const { sendToTutor } = require('../services/notificationService');
const {
  findMatchingTutors,
  distributeLeadToTutors,
  autoDistributeLead,
  getPendingDistributionLeads,
  bulkDistributeLeads,
} = require('../services/leadMatchingService');

const router = express.Router();

const parsePagination = (query) => {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

router.get('/leads', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    if (req.query.city && req.query.city !== 'all') filter['requirements.city'] = new RegExp(req.query.city, 'i');
    if (req.query.subject && req.query.subject !== 'all') filter['requirements.subjects'] = new RegExp(req.query.subject, 'i');
    if (req.query.search) {
      filter.$or = [
        { leadId: new RegExp(req.query.search, 'i') },
        { 'student.name': new RegExp(req.query.search, 'i') },
        { 'student.email': new RegExp(req.query.search, 'i') },
        { 'requirements.subjects': new RegExp(req.query.search, 'i') },
      ];
    }
    const [leads, total, active, locked, converted, unassigned] = await Promise.all([
      Lead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Lead.countDocuments(filter),
      Lead.countDocuments({ status: 'active' }),
      Lead.countDocuments({ status: 'locked' }),
      Lead.countDocuments({ status: 'converted' }),
      Lead.countDocuments({ $or: [{ lockedBy: { $size: 0 } }, { lockedBy: { $exists: false } }] }),
    ]);
    res.json({
      success: true,
      data: leads,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      stats: { total, active, locked, converted, unassigned },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/leads', async (req, res, next) => {
  try {
    const newStudent = req.body.newStudent || {};
    const requirements = req.body.requirements || {};
    const payload = {
      firstName: newStudent.firstName,
      lastName: newStudent.lastName,
      email: newStudent.email,
      phone: newStudent.phone,
      city: requirements.city || newStudent.city,
      locality: requirements.locality || newStudent.locality,
      area: requirements.area || requirements.locality || newStudent.area || newStudent.locality,
      state: requirements.state || newStudent.state,
      coordinates: requirements.coordinates || newStudent.coordinates,
      class: requirements.class,
      board: requirements.board,
      subjects: requirements.subjects || [],
      mode: requirements.mode || 'both',
      budget: requirements.budget || {},
      preferredTiming: requirements.preferredTiming || '',
      goals: requirements.goals || '',
      specialRequirements: requirements.specialRequirements || '',
      isManual: true,
      source: 'admin_manual',
      ipAddress: req.ip,
    };
    const { lead, student } = await createLeadFromEnquiry(payload, req.io);
    res.status(201).json({ success: true, data: { lead, student } });
  } catch (error) {
    next(error);
  }
});

// Get leads pending distribution
router.get('/leads/pending-distribution', async (req, res, next) => {
  try {
    const { city, subject, hours = 24, page = 1, limit = 20 } = req.query;
    
    const result = await getPendingDistributionLeads({
      city,
      subject,
      hours: Number(hours),
      page: Number(page),
      limit: Number(limit),
    });
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// Bulk distribute multiple leads
router.post('/leads/bulk-distribute', async (req, res, next) => {
  try {
    const { leadIds, strategy = 'best_match', maxPerLead = 3 } = req.body;
    
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'leadIds array is required' 
      });
    }
    
    const result = await bulkDistributeLeads(leadIds, {
      strategy,
      maxPerLead: Number(maxPerLead),
      adminId: req.userId,
    });
    
    // Log activity
    await logActivity(req, 'bulk_distribute', 'lead', null, null, { leadIds, strategy, maxPerLead, ...result });
    
    res.json({
      success: true,
      message: `Bulk distribution completed: ${result.distributed}/${result.total} leads processed`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/leads/:id', async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, data: lead });
  } catch (error) {
    next(error);
  }
});

router.post('/leads/:id/assign', async (req, res, next) => {
  try {
    const [lead, tutor] = await Promise.all([Lead.findById(req.params.id), Tutor.findById(req.body.tutorId)]);
    if (!lead || !tutor) return res.status(404).json({ success: false, message: 'Lead or tutor not found' });
    const result = await assignLeadToTutors(req.params.id, [req.body.tutorId], {
      adminId: req.userId,
      reason: req.body.reason || 'Assigned from lead profile',
      message: req.body.message,
      io: req.io,
    });
    await logActivity(req, 'assign_lead', 'lead', lead._id, lead.leadId, { tutorId: tutor._id });
    res.json({ success: true, data: result.lead });
  } catch (error) {
    next(error);
  }
});

router.post('/leads/:id/redistribute', async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    const result = await assignLeadToTutors(req.params.id, req.body.tutorIds || [], {
      adminId: req.userId,
      reason: req.body.reason || 'Redistributed by admin',
      message: req.body.message,
      io: req.io,
    });
    await logActivity(req, 'assign_lead', 'lead', lead._id, lead.leadId, req.body);
    res.json({ success: true, data: result.lead });
  } catch (error) {
    next(error);
  }
});

router.put('/leads/:id/status', async (req, res, next) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, { status: req.body.status, adminNotes: req.body.notes || '' }, { new: true });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    res.json({ success: true, data: lead });
  } catch (error) {
    next(error);
  }
});

// Convert lead to mark as converted
router.put('/leads/:id/convert', async (req, res, next) => {
  try {
    const { tutorId, notes, feedback } = req.body;
    
    if (!tutorId) {
      return res.status(400).json({ 
        success: false, 
        message: 'tutorId is required' 
      });
    }
    
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Find and update the lead
      const lead = await Lead.findById(req.params.id).session(session);
      if (!lead) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
      
      // Find and update tutor metrics
      const tutor = await Tutor.findById(tutorId).session(session);
      if (!tutor) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: 'Tutor not found' });
      }
      
      // Update lead status and conversion info
      lead.status = 'converted';
      lead.conversion = {
        convertedAt: new Date(),
        convertedBy: tutorId,
        notes: notes || '',
        feedback: feedback && typeof feedback === 'object' ? feedback : undefined,
      };
      const tutorLock = lead.lockedBy.find((lock) => lock.tutor?.toString() === tutorId.toString());
      if (tutorLock) tutorLock.status = 'converted';
      
      // Update tutor metrics
      if (!tutor.metrics) tutor.metrics = {};
      tutor.metrics.convertedLeads = (tutor.metrics.convertedLeads || 0) + 1;
      
      // Recalculate conversion rate
      const totalLeads = tutor.metrics.convertedLeads + (tutor.metrics.lostLeads || 0);
      tutor.metrics.conversionRate = totalLeads > 0 
        ? Math.round((tutor.metrics.convertedLeads / totalLeads) * 100) 
        : 0;
      
      // Save both documents
      await Promise.all([
        lead.save({ session }),
        tutor.save({ session })
      ]);
      
      // Send notification to tutor
      await sendToTutor(tutorId, {
        type: 'lead_converted',
        title: '🎉 Lead Marked as Converted!',
        message: `Congratulations! Your lead for ${lead.requirements.subjects?.[0] || 'a subject'} in ${lead.requirements.city} has been marked as converted.`,
        data: { leadId: lead._id },
        channels: { inApp: true, email: true },
        emailTo: tutor.email,
      });
      
      // Log activity
      await logActivity(req, 'convert_lead', 'lead', lead._id, lead.leadId, { tutorId, notes });
      
      await session.commitTransaction();
      
      res.json({
        success: true,
        message: 'Lead marked as converted successfully',
        data: {
          lead: await Lead.findById(req.params.id).lean(),
          tutor: await Tutor.findById(tutorId).select('firstName lastName metrics').lean()
        }
      });
      
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
    
  } catch (error) {
    next(error);
  }
});

// ─── Smart Lead Distribution Routes ────────────────────────────────────────

// Get matching tutors for a lead
router.get('/leads/:id/matching-tutors', async (req, res, next) => {
  try {
    const { planFilter, minScore = 0, limit = 20, scope = 'matching', search = '' } = req.query;
    
    const result = await findMatchingTutors(req.params.id, {
      planFilter,
      minScore: Number(minScore),
      limit: Number(limit),
      scope,
      search,
    });
    
    res.json({
      success: true,
      data: {
        lead: result.lead,
        tutors: result.tutors,
        stats: result.stats,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Smart distribute lead to selected tutors
router.post('/leads/:id/smart-distribute', async (req, res, next) => {
  try {
    const { tutorIds, message, bypassQuota = true } = req.body;
    
    if (!tutorIds || !Array.isArray(tutorIds) || tutorIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'tutorIds array is required' 
      });
    }
    
    const result = await distributeLeadToTutors(req.params.id, tutorIds, {
      message,
      bypassQuota,
      adminId: req.userId,
    });
    
    // Emit socket events for real-time updates (notifications already sent by service)
    for (const tutor of result.tutors) {
      try {
        if (req.io) {
          req.io.to(`tutor_${tutor.tutorId}`).emit('lead_assigned', {
            lead: result.lead,
            message: message || 'Admin has assigned you a new student lead',
          });
        }
      } catch (socketError) {
        console.error('Failed to emit socket event to tutor:', tutor.tutorId, socketError);
      }
    }
    
    // Log activity
    await logActivity(req, 'smart_distribute', 'lead', req.params.id, null, { tutorIds, distributed: result.distributed, bypassQuota });
    
    res.json({
      success: true,
      message: `Lead distributed to ${result.distributed} tutors successfully`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// Auto-distribute lead to best matching tutors
router.post('/leads/:id/auto-distribute', async (req, res, next) => {
  try {
    const { count = 3, planPriority = 'platinum_first' } = req.body;
    
    const result = await autoDistributeLead(req.params.id, {
      count: Number(count),
      planPriority,
      adminId: req.userId,
    });
    
    // Emit socket events for real-time updates (notifications already sent by service)
    for (const tutor of result.tutors) {
      try {
        if (req.io) {
          req.io.to(`tutor_${tutor.tutorId}`).emit('lead_assigned', {
            lead: result.lead,
            message: 'You have been automatically assigned a new student lead',
          });
        }
      } catch (socketError) {
        console.error('Failed to emit socket event to tutor:', tutor.tutorId, socketError);
      }
    }
    
    // Log activity
    await logActivity(req, 'auto_distribute', 'lead', req.params.id, null, { count: result.distributed, planPriority });
    
    res.json({
      success: true,
      message: `Lead auto-distributed to ${result.distributed} tutors successfully`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});


module.exports = router;
