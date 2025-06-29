const express = require('express');
const router = express.Router();
const estimatesController = require('../controllers/estimatesController');

router.post('/fetch-estimates', estimatesController.fetchEstimates);

module.exports = router; 