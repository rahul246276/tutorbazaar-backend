const mongoose = require('mongoose');

const enquiryTransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      unique: true,
      required: true,
    },
    tutor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tutor',
      required: true,
      index: true,
    },
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TutorPlanSubscription',
    },
    type: {
      type: String,
      enum: ['purchase', 'unlock', 'refund', 'bonus', 'expiry', 'adjustment'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    relatedLead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
    },
    relatedPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

enquiryTransactionSchema.index({ tutor: 1, createdAt: -1 });
enquiryTransactionSchema.index({ type: 1, createdAt: -1 });

enquiryTransactionSchema.pre('validate', function(next) {
  if (!this.transactionId) {
    const prefix = 'ENQ';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    this.transactionId = `${prefix}-${timestamp}-${random}`;
  }
  next();
});

module.exports =
  mongoose.models.EnquiryTransaction ||
  mongoose.model('EnquiryTransaction', enquiryTransactionSchema, 'credittransactions');
