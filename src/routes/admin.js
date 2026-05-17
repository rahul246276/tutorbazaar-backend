const express = require('express');
const { adminAuth } = require('../middleware/auth');

const analyticsRoutes = require('./adminAnalytics');
const tutorRoutes = require('./adminTutors');
const studentRoutes = require('./adminStudents');
const leadRoutes = require('./adminLeads');
const paymentRoutes = require('./adminPayments');
const managementRoutes = require('./adminManagement');

const router = express.Router();

router.use(adminAuth);
router.use(analyticsRoutes);
router.use(tutorRoutes);
router.use(studentRoutes);
router.use(leadRoutes);
router.use(paymentRoutes);
router.use(managementRoutes);

module.exports = router;
