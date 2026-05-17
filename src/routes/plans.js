const express = require('express');
const { getAllPlans } = require('../controllers/planController');

const router = express.Router();

router.get('/', getAllPlans);

module.exports = router;
