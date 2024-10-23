const User = require('../models/User');

// Controller function to get an array of addresses
const getAllAddresses = async (req, res) => {
  try {
    // Fetch only the 'address' field from all documents
    const addresses = await User.find({}, { address: 1, _id: 0 });
    
    // Extract the address field from each document and return an array
    const addressArray = addresses.map(user => user.address);
    return addressArray;
  } catch (error) {
    return error;
  }
};

module.exports = { getAllAddresses };
