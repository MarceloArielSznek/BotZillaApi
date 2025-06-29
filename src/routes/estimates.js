const express = require('express');
const router = express.Router();
const estimatesController = require('../controllers/estimatesController');

router.post('/fetch-estimates', estimatesController.fetchEstimates);
router.post('/sync-estimates', estimatesController.syncEstimates);
router.post('/send-warnings', estimatesController.sendWarnings);
router.post('/register-telegram', estimatesController.registerTelegram);
router.post('/check-telegram', estimatesController.checkTelegram);
router.get('/salespersons-list', estimatesController.getSalespersonsList);

module.exports = router; 