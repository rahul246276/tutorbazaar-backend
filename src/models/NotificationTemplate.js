const mongoose = require('mongoose');

const notificationTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },

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

  // Description of what this template is for
  description: String,

  // Template variables (e.g., {{tutorName}}, {{planName}})
  // These will be replaced when sending
  variables: [String],

  category: {
    type: String,
    enum: ['tutor_welcome', 'plan_activation', 'plan_expiry', 'lead_assignment', 'payment', 'system', 'custom'],
    default: 'custom',
  },

  isActive: { type: Boolean, default: true },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: false });

module.exports = mongoose.model('NotificationTemplate', notificationTemplateSchema);
