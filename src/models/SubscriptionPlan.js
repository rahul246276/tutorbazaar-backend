const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  // Plan Identity
  name: {
    type: String,
    enum: ['silver', 'gold', 'platinum', 'diamond'],
    required: true,
    unique: true,
    lowercase: true,
  },
  displayName: {
    type: String,
    required: true,         // "SILVER", "GOLD", "PLATINUM", "DIAMOND"
  },

  // Pricing (in rupees)
  price: {
    type: Number,
    required: true,         // 3999, 5999, 8999, 15999
  },

  // Plan Duration
  validityDays: {
    type: Number,
    required: true,         // 150 (5 months)
    default: 150,
  },

  // Enquiry Quota
  enquiryCount: {
    type: Number,
    required: true,         // 20, 30, 40, 50
  },

  // Features
  features: {
    smsAlerts: { type: Boolean, default: false },
    emailAlerts: { type: Boolean, default: true },
    noCommission: { type: Boolean, default: true },
    dedicatedSupport: { type: Boolean, default: true },
    getSuggested: { type: Boolean, default: false },    // Shown to students
    advanceAlerts: { type: Boolean, default: false },   // 15-min advance
    advanceMinutes: { type: Number, default: 0 },       // 0 for silver/gold, 15 for platinum/diamond
    freeProfileAds: { type: Boolean, default: false },  // Featured listing (diamond)
    featuredPlacement: { type: Boolean, default: false }, // Featured badge
    priorityPlacement: { type: Boolean, default: false },
  },

  // Plan Status & Display
  isActive: { type: Boolean, default: true },
  isPopular: { type: Boolean, default: false },         // Gold = true
  badge: { type: String, default: '' },                 // "MOST POPULAR" for gold
  sortOrder: { type: Number, default: 0 },

  // Admin Fields
  description: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

}, {
  timestamps: true,
});

// Index for active plans
subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
