const mongoose = require('mongoose');
const User = require('./User');

const studentSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
  },
  city: {
    type: String,
    required: [true, 'City is required'],
  },
  locality: String,
  area: String,
  state: String,
  coordinates: {
    lat: Number,
    lng: Number,
  },
  class: {
    type: String,
    required: [true, 'Class/Grade is required'],
  },
  board: {
    type: String,
    enum: ['CBSE', 'ICSE', 'State Board', 'IB', 'IGCSE', 'Other'],
  },
  subjects: [{
    name: String,
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  }],
  preferences: {
    mode: { type: String, enum: ['online', 'offline', 'both'], default: 'both' },
    budget: {
      min: Number,
      max: Number,
    },
    gender: { type: String, enum: ['male', 'female', 'any'], default: 'any' },
    experience: { type: String, enum: ['any', '1-3', '3-5', '5+'], default: 'any' },
  },
  enquiries: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
  }],
  source: { type: String, default: 'frontend_registration' },
  ipAddress: String,
  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked'],
    default: 'active',
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

studentSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

const Student = User.discriminator('student', studentSchema);
module.exports = Student;
