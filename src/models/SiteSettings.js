const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema({
  _id: { type: String, default: 'main' },
  
  // Basic Info
  siteName: { type: String, default: 'Tutor Bazaar' },
  tagline: { type: String, default: 'Learn. Teach. Grow.' },
  
  // Contact Info
  phone: { type: String },
  email: { type: String },
  whatsapp: { type: String },
  address: { type: String },
  hours: { type: String, default: '9 AM - 8 PM, 7 days a week' },
  
  // Operating Hours
  workingHours: {
    monday: { open: String, close: String },
    tuesday: { open: String, close: String },
    wednesday: { open: String, close: String },
    thursday: { open: String, close: String },
    friday: { open: String, close: String },
    saturday: { open: String, close: String },
    sunday: { open: String, close: String },
  },
  
  // Social Links
  social: {
    facebook: String,
    instagram: String,
    twitter: String,
    youtube: String,
    linkedin: String,
  },
  
  // Lead Settings
  leadSettings: {
    unlockCost: { type: Number, default: 1 },              // enquiries per lead
    leadExpiryHours: { type: Number, default: 48 },        // hours before lead auto-expires
    maxTutorsPerLead: { type: Number, default: 3 },        // max tutors who can unlock same lead
    advanceAlertMinutes: { type: Number, default: 15 },    // premium tutors see leads 15 min early
  },
  
  // Payment Settings
  paymentSettings: {
    platformCommissionPercent: { type: Number, default: 10 },  // 10% commission on plan price
    minWithdrawalAmount: { type: Number, default: 500 },
    withdrawalFeePercent: { type: Number, default: 5 },
  },
  
  // Feature Flags
  features: {
    emailNotificationsEnabled: { type: Boolean, default: true },
    smsNotificationsEnabled: { type: Boolean, default: false },
    videoCallsEnabled: { type: Boolean, default: false },
    reviewsEnabled: { type: Boolean, default: true },
  },

  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: false });

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
