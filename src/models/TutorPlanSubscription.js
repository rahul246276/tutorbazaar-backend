const mongoose = require('mongoose');

const tutorPlanSubscriptionSchema = new mongoose.Schema({
  // Subscription Identity
  tutor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tutor',
    required: true,
  },

  // Plan Details (snapshot at purchase time)
  plan: {
    type: String,
    enum: ['silver', 'gold', 'platinum', 'diamond'],
    required: true,
  },
  planSnapshot: {
    displayName: String,
    price: Number,
    validityDays: Number,
    enquiryCount: Number,
    features: mongoose.Schema.Types.Mixed,
  },

  // Subscription Status
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled', 'suspended'],
    default: 'active',
    index: true,
  },

  // Dates
  startDate: {
    type: Date,
    required: true,
    default: Date.now,
  },
  expiryDate: {
    type: Date,
    required: true,
  },
  renewalDate: Date,

  // Enquiry Tracking
  totalEnquiries: {
    type: Number,
    required: true,         // 20, 30, 40, or 50
  },
  usedEnquiries: {
    type: Number,
    default: 0, // How many tutors unlocked
  },

  // Extra Enquiries (added by admin)
  extraEnquiries: {
    type: Number,
    default: 0,             // Additional enquiries added manually
  },
  warningNotificationSent: { type: Boolean, default: false },
  lowEnquiryNotificationSentAt: { type: Date },

  // Payment Reference
  payment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
  },
  razorpaySubscriptionId: String,

  // Activation Details
  activatedBy: {
    type: String,
    enum: ['razorpay', 'admin', 'promo'],
    default: 'razorpay',
  },
  activatedAt: {
    type: Date,
    default: Date.now,
  },

  // Admin Notes
  notes: String,

  // Auto-renewal Settings
  autoRenew: { type: Boolean, default: false },
  renewalFailureCount: { type: Number, default: 0 },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual for remaining enquiries
tutorPlanSubscriptionSchema.virtual('remainingEnquiries').get(function() {
  return (this.totalEnquiries + this.extraEnquiries) - this.usedEnquiries;
});

// Virtual for days remaining
tutorPlanSubscriptionSchema.virtual('daysRemaining').get(function() {
  const today = new Date();
  const diff = this.expiryDate - today;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
});

// Virtual for is expiring soon (within 7 days)
tutorPlanSubscriptionSchema.virtual('isExpiringSoon').get(function() {
  return this.daysRemaining <= 7 && this.daysRemaining > 0;
});

// Index for expiry tracking and active subscriptions
tutorPlanSubscriptionSchema.index({ status: 1, expiryDate: 1 });
tutorPlanSubscriptionSchema.index({ tutor: 1, createdAt: -1 });
tutorPlanSubscriptionSchema.index({ tutor: 1, status: 1, expiryDate: -1 });
tutorPlanSubscriptionSchema.index({ plan: 1, status: 1 });

module.exports = mongoose.model('TutorPlanSubscription', tutorPlanSubscriptionSchema);
