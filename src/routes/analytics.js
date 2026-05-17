const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const Lead = require('../models/Lead');
const Tutor = require('../models/Tutor');
const Student = require('../models/Student');
const Payment = require('../models/Payment');

// Platform analytics (admin only)
router.get('/platform', auth, authorize('admin'), async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalTutors,
      newTutors,
      totalStudents,
      totalLeads,
      newLeads,
      convertedLeads,
      totalRevenue,
    ] = await Promise.all([
      Tutor.countDocuments({ isApproved: true }),
      Tutor.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Student.countDocuments(),
      Lead.countDocuments(),
      Lead.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Lead.countDocuments({ status: 'converted' }),
      Payment.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        tutors: { total: totalTutors, newThisMonth: newTutors },
        students: { total: totalStudents },
        leads: {
          total: totalLeads,
          newThisMonth: newLeads,
          converted: convertedLeads,
          conversionRate: totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0,
        },
        revenue: { total: totalRevenue[0]?.total || 0 },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
