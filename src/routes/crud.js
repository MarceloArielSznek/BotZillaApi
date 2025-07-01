const express = require('express');
const router = express.Router();
const crud = require('../controllers/crudController');

// Salespersons
router.get('/salesperson', crud.getAllSalespersons);
router.get('/salesperson/with-active-jobs', crud.getSalespersonsWithActiveJobs);
router.get('/salesperson/warnings-manager', crud.getSalespersonsWithWarningsForManager);
router.get('/salesperson/:id', crud.getSalesperson);
router.post('/salesperson', crud.createSalesperson);
router.put('/salesperson/:id', crud.updateSalesperson);
router.delete('/salesperson/:id', crud.deleteSalesperson);

// Branches
router.get('/branch', crud.getAllBranches);
router.get('/branch/:id', crud.getBranch);
router.post('/branch', crud.createBranch);
router.put('/branch/:id', crud.updateBranch);
router.delete('/branch/:id', crud.deleteBranch);

// Statuses
router.get('/status', crud.getAllStatuses);
router.get('/status/:id', crud.getStatus);
router.post('/status', crud.createStatus);
router.put('/status/:id', crud.updateStatus);
router.delete('/status/:id', crud.deleteStatus);

// Estimates
router.get('/estimate', crud.getAllEstimates);
router.get('/estimate/details', crud.getEstimatesWithDetails);
router.get('/estimate/:id', crud.getEstimate);
router.post('/estimate', crud.createEstimate);
router.put('/estimate/:id', crud.updateEstimate);
router.delete('/estimate/:id', crud.deleteEstimate);

module.exports = router; 