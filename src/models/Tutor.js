const mongoose = require('mongoose');
const User = require('./User');

const tutorSchema = new mongoose.Schema({
  firstName: { type: String, required: [true, 'First name is required'], trim: true },
  lastName: { type: String, required: [true, 'Last name is required'], trim: true },
  bio: { type: String, maxlength: [1000, 'Bio cannot exceed 1000 characters'] },
  headline: { type: String, maxlength: [150, 'Headline cannot exceed 150 characters'] },

  subjects: [{
    name: { type: String, required: true },
    levels: [{ type: String }],
    boards: [{ type: String }],
  }],

  city: { type: String, required: [true, 'City is required'], index: true },
  locality: { type: String },
  teachingModes: [{ type: String, enum: ['online', 'offline', 'both'] }],

  pricing: {
    hourlyRate: { type: Number, min: 0 },
    monthlyRate: { type: Number, min: 0 },
    currency: { type: String, default: 'INR' },
  },

  isApproved: { type: Boolean, default: false, index: true },
  isFeatured: { type: Boolean, default: false },
  featuredUntil: { type: Date },
  adminNotes: { type: String },
  studentsTaught: { type: Number, default: 0 },
  responseRate: { type: Number, default: 0 },

  // Admin audit fields
  approvedAt: { type: Date },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Suspension info
  suspension: {
    isSuspended: { type: Boolean, default: false },
    reason: String,  // policy_violation, fake_profile, student_complaint, inactivity, other
    customReason: String,
    suspendedAt: { type: Date },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },

  // Profile Picture
  profilePicture: { type: String },

  documents: {
    idProof: {
      url: { type: String, default: '' },
      status: {
        type: String,
        enum: ['pending', 'verified', 'rejected', 'not_uploaded'],
        default: 'not_uploaded',
      },
    },
    degreeCertificate: {
      url: { type: String, default: '' },
      status: {
        type: String,
        enum: ['pending', 'verified', 'rejected', 'not_uploaded'],
        default: 'not_uploaded',
      },
    },
  },

  education: [{ degree: String, institution: String, year: Number, score: String }],
  experience: { years: { type: Number, default: 0 }, details: String },

  rating: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 },
  },

  // NEW: Plan Subscription (replaces old subscription.plan)
  subscription: {
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TutorPlanSubscription',
    },
    currentPlanName: {
      type: String,
      enum: ['silver', 'gold', 'platinum', 'diamond', 'none'],
      default: 'none',
    },
    expiryDate: Date,
    enquiriesTotal: { type: Number, default: 0 },
    enquiriesUsed: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['active', 'expired', 'none'],
      default: 'none',
    },
    remainingEnquiries: { type: Number, default: 0 },
  },

  availability: {
    schedule: { type: Map, of: [{ start: String, end: String }], default: {} },
    acceptingNewStudents: { type: Boolean, default: true },
  },

  metrics: {
    totalLeads: { type: Number, default: 0 },
    unlockedLeads: { type: Number, default: 0 },
    convertedLeads: { type: Number, default: 0 },
    responseRate: { type: Number, default: 0 },
    conversionRate: { type: Number, default: 0 },
    avgResponseTime: { type: Number, default: 0 },
    profileViews: { type: Number, default: 0 },
    rankingScore: { type: Number, default: 0 },
  },

  preferences: {
    maxDistance: { type: Number, default: 10 },
    minBudget: { type: Number, default: 0 },
    preferredClasses: [{ type: String }],
  },
  lastLowEnquiryAlertAt: { type: Date },

  notifications: [{
    type: { type: String, enum: ['lead', 'message', 'system', 'payment'] },
    title: String,
    message: String,
    isRead: { type: Boolean, default: false },
    data: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
  }],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

tutorSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

tutorSchema.virtual('profileCompletion').get(function () {
  let completed = 0;
  const total = 8;
  if (this.bio) completed++;
  if (this.subjects && this.subjects.length > 0) completed++;
  if (this.city) completed++;
  if (this.pricing && (this.pricing.hourlyRate || this.pricing.monthlyRate)) completed++;
  if (this.education && this.education.length > 0) completed++;
  if (this.experience && this.experience.years > 0) completed++;
  if (this.availability?.schedule && this.availability.schedule.size > 0) completed++;
  if (this.profilePicture) completed++;
  return Math.round((completed / total) * 100);
});

tutorSchema.virtual('remainingEnquiries').get(function () {
  const total = this.subscription?.enquiriesTotal || 0;
  const used = this.subscription?.enquiriesUsed || 0;
  const remaining = this.subscription?.remainingEnquiries;
  return typeof remaining === 'number' ? remaining : Math.max(total - used, 0);
});

tutorSchema.index({ city: 1, 'subjects.name': 1, isApproved: 1 });
tutorSchema.index({ isFeatured: 1, featuredUntil: 1 });
tutorSchema.index({ 'metrics.rankingScore': -1 });
tutorSchema.index({ 'subscription.currentPlanName': 1, 'subscription.status': 1 });
tutorSchema.index({ isApproved: 1, 'subscription.status': 1 });

tutorSchema.methods.updateRankingScore = function () {
  const weights = { rating: 0.3, conversion: 0.25, response: 0.2, profile: 0.15, featured: 0.1 };
  const ratingScore = (this.rating.average / 5) * 100;
  const conversionScore = this.metrics.conversionRate;
  const responseScore = this.metrics.responseRate;
  const profileScore = this.profileCompletion;
  const featuredScore = this.isFeatured ? 100 : 0;

  this.metrics.rankingScore = (
    ratingScore * weights.rating +
    conversionScore * weights.conversion +
    responseScore * weights.response +
    profileScore * weights.profile +
    featuredScore * weights.featured
  );
  return this.save({ validateBeforeSave: false });
};

tutorSchema.methods.applySubscriptionSnapshot = function (subscription) {
  const total = (subscription.totalEnquiries || 0) + (subscription.extraEnquiries || 0);
  const used = subscription.usedEnquiries || 0;
  this.subscription = {
    plan: subscription._id,
    currentPlanName: subscription.plan,
    expiryDate: subscription.expiryDate,
    enquiriesTotal: total,
    enquiriesUsed: used,
    remainingEnquiries: Math.max(total - used, 0),
    status: subscription.status === 'active' ? 'active' : 'expired',
  };
  return this;
};

tutorSchema.methods.addEnquiries = function (amount, session = null) {
  this.subscription.enquiriesTotal = (this.subscription.enquiriesTotal || 0) + amount;
  this.subscription.remainingEnquiries = Math.max(
    (this.subscription.enquiriesTotal || 0) - (this.subscription.enquiriesUsed || 0),
    0
  );
  return session ? this.save({ session }) : this.save();
};

tutorSchema.methods.useEnquiry = function (amount = 1, session = null) {
  if ((this.subscription.remainingEnquiries || 0) < amount) {
    throw new Error('Insufficient enquiries remaining');
  }
  this.subscription.enquiriesUsed = (this.subscription.enquiriesUsed || 0) + amount;
  this.subscription.remainingEnquiries = Math.max(
    (this.subscription.enquiriesTotal || 0) - (this.subscription.enquiriesUsed || 0),
    0
  );
  return session ? this.save({ session }) : this.save();
};

tutorSchema.methods.addNotification = async function (notificationData) {
  this.notifications.unshift(notificationData);
  if (this.notifications.length > 50) {
    this.notifications = this.notifications.slice(0, 50);
  }
  return this.save({ validateBeforeSave: false });
};

const Tutor = User.discriminator('tutor', tutorSchema);
module.exports = Tutor;
