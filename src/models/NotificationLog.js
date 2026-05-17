const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema({
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  
  // Target information
  target: {
    type: String,
    enum: ['all', 'specific', 'by_plan', 'expiring_soon', 'custom'],
    required: true,
  },
  
  targetDetails: {
    planFilter: String,           // if target='by_plan'
    daysToExpiry: Number,         // if target='expiring_soon'
    excludedTutorIds: [mongoose.Schema.Types.ObjectId],  // explicit exclusions
  },
  
  // Message Content
  title: {
    type: String,
    required: true,
    maxlength: 80,
  },
  
  message: {
    type: String,
    required: true,
    maxlength: 500,
  },
  
  // Channels
  channels: {
    inApp: { type: Boolean, default: true },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
  },
  
  // Results
  recipientCount: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  
  failedRecipients: [{
    tutorId: mongoose.Schema.Types.ObjectId,
    tutorEmail: String,
    reason: String,
  }],
  
  sentAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, { timestamps: false });

notificationLogSchema.index({ sentBy: 1, sentAt: -1 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
