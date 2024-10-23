const mongoose = require('mongoose');

const socialHandlesSchema = new mongoose.Schema({
  twitter: String,
  github: String,
  discord: String,
  // Add more social media fields as needed
}, { _id: false });

const userSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
  },
  image: {
    type: String,
    default: '', // If image is not always provided, a default value can be used
  },
  description: {
    type: String,
    default: '',
  },
  daoName: {
    type: String,
    required: true,
  },
  isDelegate: {
    type: Boolean,
    default: false,
  },
  displayName: {
    type: String,
    required: true,
  },
  emailId: {
    type: String,
    default: '',
  },
  socialHandles: {
    type: socialHandlesSchema,
    default: {},
  },
}, { timestamps: true });

module.exports = mongoose.model('delegates', userSchema);
