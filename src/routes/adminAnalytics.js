const express = require('express');
const Tutor = require('../models/Tutor');
const Student = require('../models/Student');
const Lead = require('../models/Lead');
const Payment = require('../models/Payment');
const TutorPlanSubscription = require('../models/TutorPlanSubscription');
const ContactMessage = require('../models/ContactMessage');

const router = express.Router();

const analyticsHandler = async (req, res, next) => {
  try {
    const period = req.query.period || '30d';
    const now = new Date();
    const periodDays = { '7d': 7, '30d': 30, '3m': 90, '1y': 365 }[period] || 30;
    const startDate = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalTutors,
      pendingTutors,
      totalStudents,
      totalLeads,
      todayLeads,
      activeLeads,
      lockedLeads,
      convertedLeadsCount,
      unassignedLeads,
      revenueDocs,
      monthRevenueDocs,
      recentTutors,
      recentPayments,
      expiringPlans,
      unreadMessages,
      planDistributionRaw,
      topCitiesRaw,
    ] = await Promise.all([
      Tutor.countDocuments({}),
      Tutor.countDocuments({ isApproved: false }),
      Student.countDocuments({}),
      Lead.countDocuments({}),
      Lead.countDocuments({ createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }),
      Lead.countDocuments({ status: 'active' }),
      Lead.countDocuments({ status: 'locked' }),
      Lead.countDocuments({ status: 'converted' }),
      Lead.countDocuments({ $or: [{ lockedBy: { $size: 0 } }, { lockedBy: { $exists: false } }] }),
      Payment.find({ status: 'paid', createdAt: { $gte: startDate } }).lean(),
      Payment.find({ status: 'paid', createdAt: { $gte: thisMonthStart } }).lean(),
      Tutor.find({}).sort({ createdAt: -1 }).limit(5).lean(),
      Payment.find({ status: 'paid' }).sort({ createdAt: -1 }).limit(5).populate('user', 'firstName lastName').lean(),
      TutorPlanSubscription.countDocuments({
        status: 'active',
        expiryDate: { $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
      }),
      ContactMessage.countDocuments({ status: { $in: ['new', 'read'] } }),
      Tutor.aggregate([
        { $match: { 'subscription.status': 'active' } },
        { $group: { _id: '$subscription.currentPlanName', value: { $sum: 1 } } },
      ]),
      Lead.aggregate([
        { $group: { _id: '$requirements.city', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
    ]);

    const totalRevenue = revenueDocs.reduce((sum, item) => sum + (item.finalAmount || item.amount || 0), 0);
    const thisMonthRevenue = monthRevenueDocs.reduce((sum, item) => sum + (item.finalAmount || item.amount || 0), 0);
    const conversionRate = totalLeads ? Math.round((convertedLeadsCount / totalLeads) * 100) : 0;

    const revenue = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
        const nextMonth = new Date(now.getFullYear(), now.getMonth() - (4 - index), 1);
        const docs = await Payment.find({ status: 'paid', createdAt: { $gte: monthStart, $lt: nextMonth } }).lean();
        return {
          name: monthStart.toLocaleDateString('en-IN', { month: 'short' }),
          month: monthStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
          amount: docs.reduce((sum, item) => sum + (item.finalAmount || item.amount || 0), 0),
          revenue: docs.reduce((sum, item) => sum + (item.finalAmount || item.amount || 0), 0),
        };
      })
    );

    const registrations = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
        const nextMonth = new Date(now.getFullYear(), now.getMonth() - (4 - index), 1);
        const [tutors, students] = await Promise.all([
          Tutor.countDocuments({ createdAt: { $gte: monthStart, $lt: nextMonth } }),
          Student.countDocuments({ createdAt: { $gte: monthStart, $lt: nextMonth } }),
        ]);
        return {
          month: monthStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
          tutors,
          students,
        };
      })
    );

    res.json({
      success: true,
      data: {
        stats: {
          tutors: { total: totalTutors, pending: pendingTutors },
          students: { total: totalStudents },
          leads: { total: totalLeads, today: todayLeads, active: activeLeads, locked: lockedLeads, converted: convertedLeadsCount, unassigned: unassignedLeads },
          revenue: { total: totalRevenue, thisMonth: thisMonthRevenue },
          conversion: { rate: conversionRate },
          conversionRate,
        },
        charts: {
          revenue,
          registrations,
          planDistribution: planDistributionRaw.map((item) => ({ name: item._id || 'No Plan', value: item.value })),
          topCities: topCitiesRaw.map((item) => ({ city: item._id, count: item.count })),
          leadDistribution: topCitiesRaw.map((item) => ({ name: item._id || 'Unknown', value: item.count })),
        },
        recentTutors,
        recentPayments,
        alerts: {
          pendingApproval: pendingTutors,
          expiringPlans,
          unreadMessages,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

router.get('/analytics', analyticsHandler);
router.get('/dashboard', analyticsHandler);

// Conversion analytics endpoint
router.get('/conversions', async (req, res, next) => {
  try {
    const period = req.query.period || '30d';
    const now = new Date();
    const periodDays = { '7d': 7, '30d': 30, '3m': 90, '1y': 365 }[period] || 30;
    const startDate = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

    const funnelData = [
      { name: 'Total Leads', value: await Lead.countDocuments({ createdAt: { $gte: startDate } }), percentage: 100 },
      { name: 'Active Leads', value: await Lead.countDocuments({ status: 'active', createdAt: { $gte: startDate } }), percentage: 85 },
      { name: 'Assigned Leads', value: await Lead.countDocuments({ 'lockedBy.0': { $exists: true }, createdAt: { $gte: startDate } }), percentage: 65 },
      { name: 'Contacted Leads', value: await Lead.countDocuments({ 'lockedBy.status': 'contacted', createdAt: { $gte: startDate } }), percentage: 45 },
      { name: 'Converted Leads', value: await Lead.countDocuments({ status: 'converted', createdAt: { $gte: startDate } }), percentage: 25 },
    ];

    res.json({ success: true, data: { funnel: funnelData } });
  } catch (error) {
    next(error);
  }
});

// Leaderboard endpoint
router.get('/leaderboard', async (req, res, next) => {
  try {
    const period = req.query.period || '30d';
    const now = new Date();
    const periodDays = { '7d': 7, '30d': 30, '3m': 90, '1y': 365 }[period] || 30;
    const startDate = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

    // Tutor leaderboard
    const tutorLeaderboard = await Lead.aggregate([
      { $match: { status: 'converted', createdAt: { $gte: startDate } } },
      { $unwind: '$lockedBy' },
      { $group: { _id: '$lockedBy.tutor', conversions: { $sum: 1 }, revenue: { $sum: '$requirements.budget.max' } } },
      { $sort: { conversions: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'tutor' } },
      { $unwind: '$tutor' },
      {
        $project: {
          _id: 0,
          name: { $concat: ['$tutor.firstName', ' ', '$tutor.lastName'] },
          conversions: 1,
          revenue: 1,
          rating: '$tutor.rating',
          responseTime: '$tutor.avgResponseTime'
        }
      }
    ]);

    // Add rank to tutor leaderboard
    const rankedTutorLeaderboard = tutorLeaderboard.map((tutor, index) => ({
      ...tutor,
      rank: index + 1
    }));

    // City leaderboard
    const cityLeaderboard = await Lead.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$requirements.city', leads: { $sum: 1 }, conversions: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } } } },
      { $addFields: { conversionRate: { $multiply: [{ $divide: ['$conversions', '$leads'] }, 100] } } },
      { $sort: { conversions: -1 } },
      { $limit: 10 },
      { $addFields: { revenue: { $multiply: ['$conversions', 5000] } } } // Mock revenue calculation
    ]);

    // Subject leaderboard
    const subjectLeaderboard = await Lead.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $unwind: '$requirements.subjects' },
      { $group: { _id: '$requirements.subjects', leads: { $sum: 1 }, conversions: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } } } },
      { $addFields: { conversionRate: { $multiply: [{ $divide: ['$conversions', '$leads'] }, 100] } } },
      { $sort: { conversions: -1 } },
      { $limit: 10 },
      { $addFields: { avgPrice: 6000 } } // Mock average price
    ]);

    res.json({ success: true, data: { tutors: rankedTutorLeaderboard, cities: cityLeaderboard, subjects: subjectLeaderboard } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
