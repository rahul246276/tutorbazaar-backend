const mongoose = require('mongoose');

const promoCodeSchema = new mongoose.Schema({
  // Code Identity
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true,
  },

  // Discount Type
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true,
  },
  discountValue: {
    type: Number,
    required: true,         // % or rupees
    min: 0,
  },

  // Applicability
  applicablePlans: {
    type: [String],         // ['silver', 'gold'] or 'all'
    default: 'all',
  },
  minPurchaseAmount: { type: Number, default: 0 },

  // Usage Limits
  maxUses: {
    type: Number,
    default: null,           // null = unlimited
  },
  usedCount: {
    type: Number,
    default: 0,
  },
  maxUsesPerUser: {
    type: Number,
    default: 1,              // Can use once per tutor
  },

  // Active Period
  validFrom: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  isActive: { type: Boolean, default: true, index: true },

  // Admin
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  description: String,

  // Usage History
  usageHistory: [{
    tutor: { type: mongoose.Schema.Types.ObjectId, ref: 'Tutor' },
    plan: String,
    discountAmount: Number,
    usedAt: { type: Date, default: Date.now },
  }],

}, {
  timestamps: true,
});

// Pre-check method: can this code be used?
promoCodeSchema.methods.canBeUsed = function() {
  const now = new Date();
  if (!this.isActive) return false;
  if (now < this.validFrom || now > this.expiresAt) return false;
  if (this.maxUses && this.usedCount >= this.maxUses) return false;
  return true;
};

// Method: calculate discount
promoCodeSchema.methods.calculateDiscount = function(planPrice) {
  if (this.discountType === 'percentage') {
    return (planPrice * this.discountValue) / 100;
  } else {
    return Math.min(this.discountValue, planPrice);
  }
};

// Indexes
promoCodeSchema.index({ code: 1, isActive: 1 });
promoCodeSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('PromoCode', promoCodeSchema);
