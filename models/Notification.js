const mongoose = require('mongoose');

// Define Notification Schema matching the TypeScript interface
const notificationSchema = new mongoose.Schema({
    receiver_address: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true
    },
    createdAt: {
      type: Number,  // Changed to Number to match the interface
      default: () => Date.now(), // Returns timestamp in milliseconds
      required: true
    },
    read_status: {
      type: Boolean,
      default: false,
      required: true
    },
    notification_name: {
      type: String,
      required: true
    },
    notification_title: {
      type: String,
      required: true
    },
    notification_type: {
      type: String,
      required: true
    },
    additionalData: {
      type: mongoose.Schema.Types.Mixed,  // Allows any type of data
      required: false
    }
  }, {
    // This will ensure virtual _id and id are both available
    toJSON: { 
      virtuals: true,
      transform: function(doc, ret) {
        ret.id = ret._id;
        return ret;
      }
    },
    toObject: { virtuals: true }
  });
module.exports = mongoose.model('notifications', notificationSchema);