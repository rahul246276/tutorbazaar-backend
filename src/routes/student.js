const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const Student = require('../models/Student');
const ContactMessage = require('../models/ContactMessage');
const { sendEmail } = require('../utils/email');
const { createLeadFromEnquiry } = require('../services/leadService');
const logger = require('../utils/logger');

const router = express.Router();

router.post('/enquiry', async (req, res, next) => {
  try {
    const subjects = Array.isArray(req.body.subjects)
      ? req.body.subjects.filter(Boolean)
      : [req.body.subject].filter(Boolean);

    if (!req.body.firstName || !req.body.lastName || !req.body.email || !req.body.phone || !req.body.city || !req.body.class || subjects.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, email, phone, city, class and subject are required',
      });
    }

    const payload = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      phone: req.body.phone,
      city: req.body.city,
      locality: req.body.locality || '',
      area: req.body.area || req.body.locality || '',
      state: req.body.state || '',
      coordinates: req.body.coordinates,
      class: req.body.class,
      board: req.body.board || 'Other',
      subjects,
      mode: req.body.mode || 'both',
      budget: req.body.budget || {},
      preferredTiming: req.body.preferredTiming || '',
      startDate: req.body.startDate ? new Date(req.body.startDate) : null,
      goals: req.body.goals || '',
      specialRequirements: req.body.specialRequirements || '',
      source: req.body.source || 'website_enquiry',
      ipAddress: req.ip,
    };

    const { lead } = await createLeadFromEnquiry(payload, req.io);

    res.status(201).json({
      success: true,
      message: 'Enquiry submitted successfully',
      data: {
        leadId: lead.leadId,
        lead,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/profile', auth, authorize('student'), async (req, res, next) => {
  try {
    const student = await Student.findById(req.userId).populate('enquiries').lean();
    res.json({ success: true, data: { student } });
  } catch (error) {
    next(error);
  }
});

router.put('/profile', auth, authorize('student'), async (req, res, next) => {
  try {
    const allowed = ['firstName', 'lastName', 'phone', 'city', 'locality', 'class', 'board', 'subjects', 'preferences'];
    const updates = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const student = await Student.findByIdAndUpdate(req.userId, updates, {
      new: true,
      runValidators: true,
    });

    res.json({ success: true, data: { student } });
  } catch (error) {
    next(error);
  }
});

router.post('/contact', async (req, res, next) => {
  try {
    const { name, email, phone, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, subject and message are required',
      });
    }

    const savedMessage = await ContactMessage.create({
      name,
      email,
      phone: phone || '',
      subject,
      message,
      source: 'website',
    });

    const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
    if (supportEmail) {
      sendEmail({
        to: supportEmail,
        subject: `[TutorBazaar Contact] ${subject}`,
        html: `<p><strong>${name}</strong> (${email})</p><p>${message}</p>`,
        text: `${name} (${email})\n\n${message}`,
      }).catch((error) => {
        logger.warn('Contact email failed: %s', error.message);
      });
    }

    if (req.io) {
      req.io.to('admin_room').emit('contact_received', { message: savedMessage });
    }

    res.json({
      success: true,
      message: 'Message received successfully',
      data: { contactId: savedMessage._id },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
