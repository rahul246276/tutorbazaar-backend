const AdminActivityLog = require('../models/AdminActivityLog');
const logger = require('./logger');

/**
 * Utility functions for logging admin activities
 * This provides the same functionality as the middleware but can be called directly
 */

const logActivity = async (adminId, action, targetType, targetId, targetName, details = {}, ipAddress = null, userAgent = null) => {
  try {
    await AdminActivityLog.create({
      admin: adminId,
      action,
      targetType,
      targetId,
      targetName,
      details,
      ipAddress: ipAddress || 'system',
      userAgent: userAgent || 'system',
    });
  } catch (error) {
    logger.warn('Activity log failed: %s', error.message);
  }
};

const logSystemActivity = async (action, targetType, targetId, targetName, details = {}) => {
  try {
    await AdminActivityLog.create({
      admin: null,
      action,
      targetType,
      targetId,
      targetName,
      details,
      ipAddress: 'system',
      userAgent: 'system',
    });
  } catch (error) {
    logger.warn('System activity log failed: %s', error.message);
  }
};

module.exports = {
  logActivity,
  logSystemActivity
};
