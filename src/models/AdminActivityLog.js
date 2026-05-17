const mongoose = require('mongoose');

const adminActivityLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  
  // Action Type
  action: {
    type: String,
    enum: [
      'approve_tutor',
      'suspend_tutor',
      'reactivate_tutor',
      'edit_tutor',
      'featured_tutor',
      'assign_lead',
      'smart_distribute',
      'auto_distribute',
      'bulk_distribute',
      'convert_lead',
      'activate_plan',
      'add_enquiries',
      'extend_plan',
      'cancel_plan',
      'send_notification',
      'approve_review',
      'reject_review',
      'delete_review',
      'refund_payment',
      'update_plan',
      'create_plan',
      'delete_plan',
      'create_promo_code',
      'delete_promo_code',
      'update_settings',
      'block_student',
      'create_tutor',
      'create_student',
      'other',
    ],
    required: true,
  },
  
  // Target Info
  targetType: {
    type: String,
    enum: ['tutor', 'student', 'lead', 'payment', 'plan', 'review', 'promo_code', 'settings', 'other'],
    required: true,
  },
  
  targetId: mongoose.Schema.Types.ObjectId,
  targetName: String,  // For display (e.g., tutor name, lead subject)
  
  // Details
  details: mongoose.Schema.Types.Mixed,  // Flexible storage for specific action data
  
  // Request Info
  ipAddress: String,
  userAgent: String,
  
  // Status
  success: { type: Boolean, default: true },
  resultMessage: String,  // If failed, why
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, { timestamps: false });

// Indexes for querying
adminActivityLogSchema.index({ admin: 1, createdAt: -1 });
adminActivityLogSchema.index({ targetType: 1, targetId: 1 });
adminActivityLogSchema.index({ action: 1 });

module.exports = mongoose.model('AdminActivityLog', adminActivityLogSchema);
