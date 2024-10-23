const express = require('express');
const router = express.Router();
const { getAllAddresses } = require('../controllers/userController');

// Route to get all addresses
router.get('/', getAllAddresses);

module.exports = router;
