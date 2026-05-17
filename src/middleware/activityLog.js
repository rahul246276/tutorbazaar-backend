const AdminActivityLog = require('../models/AdminActivityLog');
const logger = require('../utils/logger');

const logActivity = async (req, action, targetType, targetId, targetName, details = {}) => {
  try {
    await AdminActivityLog.create({
      admin: req.userId,
      action,
      targetType,
      targetId,
      targetName,
      details,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  } catch (error) {
    logger.warn('Activity log failed: %s', error.message);
  }
};

module.exports = { logActivity };
