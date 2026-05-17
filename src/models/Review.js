const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  // Reviewer & Subject
  tutor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tutor',
    required: true,
    index: true,
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
  },
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
  },

  // Review Content
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
    index: true,
  },
  review: { type: String, maxlength: 1000 },

  // Verification
  isVerified: { type: Boolean, default: false }, // Only if lead exists
  isApproved: { type: Boolean, default: false }, // Admin moderation

  // Tutor Reply
  reply: {
    text: String,
    repliedAt: Date,
  },

  // Moderation
  flaggedForInappropriate: { type: Boolean, default: false },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedReason: String,

}, {
  timestamps: true,
  indexes: [
    { tutor: 1, isApproved: 1 },
    { tutor: 1, rating: 1 },
    { createdAt: -1 },
  ],
});

module.exports = mongoose.model('Review', reviewSchema);
