const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Recipient
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  recipientRole: {
    type: String,
    enum: ['tutor', 'student', 'admin'],
    required: true,
  },

  // Notification Type
  type: {
    type: String,
    enum: [
      'new_lead',
      'lead_assigned',
      'plan_expiry',
      'plan_activated',
      'lead_converted',
      'profile_approved',
      'profile_rejected',
      'review_received',
      'enquiry_low',
      'custom',
      'system',
    ],
    required: true,
    index: true,
  },

  // Content
  title: { type: String, required: true },
  message: { type: String, required: true },
  icon: String,                          // emoji or icon name
  actionUrl: String,                     // link to perform action

  // Extra Data
  data: {
    type: mongoose.Schema.Types.Mixed,   // leadId, planName, etc.
  },

  // Status
  isRead: { type: Boolean, default: false },
  readAt: Date,

  // Channels
  channels: {
    inApp: { type: Boolean, default: true },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
  },

  // Delivery Status
  emailSent: { type: Boolean, default: false },
  smsSent: { type: Boolean, default: false },
  sentAt: Date,

  // Admin Fields
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // If sent by admin manually

}, {
  timestamps: true,
  indexes: [
    { recipient: 1, isRead: 1, createdAt: -1 },
    { recipient: 1, createdAt: -1 },
    { type: 1, createdAt: -1 },
  ],
});

// Pre-save hook to set sentAt timestamp
notificationSchema.pre('save', function(next) {
  if (!this.isNew) return next();
  if (this.channels.inApp || this.channels.email || this.channels.sms) {
    this.sentAt = new Date();
  }
  next();
});

module.exports = mongoose.model('Notification', notificationSchema);
