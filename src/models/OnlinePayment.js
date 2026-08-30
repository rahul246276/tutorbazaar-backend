const mongoose = require('mongoose');

const onlinePaymentSchema = new mongoose.Schema({
  razorpayOrderId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  razorpayPaymentId: {
    type: String,
    sparse: true,
    unique: true,
  },
  razorpaySignature: String,

  payer: {
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
  },

  selectionType: {
    type: String,
    enum: ['plan', 'custom'],
    required: true,
  },
  planName: {
    type: String,
    enum: ['silver', 'gold', 'platinum', 'diamond'],
  },
  description: String,

  baseAmount: {
    type: Number,
    required: true,
  },
  gstRate: {
    type: Number,
    default: 18,
  },
  gstAmount: {
    type: Number,
    required: true,
  },
  totalAmount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'INR',
  },

  status: {
    type: String,
    enum: ['created', 'paid', 'failed', 'cancelled'],
    default: 'created',
    index: true,
  },
  paidAt: Date,

  webhookEvents: [{
    event: String,
    receivedAt: Date,
    payload: mongoose.Schema.Types.Mixed,
  }],

  metadata: {
    type: Map,
    of: String,
  },
}, {
  timestamps: true,
});

onlinePaymentSchema.index({ status: 1, createdAt: -1 });
onlinePaymentSchema.index({ 'payer.phone': 1, createdAt: -1 });

module.exports = mongoose.model('OnlinePayment', onlinePaymentSchema);
