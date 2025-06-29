const express = require('express');
const router = express.Router();
const estimatesController = require('../controllers/estimatesController');

router.post('/fetch-estimates', estimatesController.fetchEstimates);
router.post('/sync-estimates', estimatesController.syncEstimates);
router.post('/send-warnings', estimatesController.sendWarnings);

module.exports = router; 