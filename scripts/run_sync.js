require('dotenv').config();
const { runLeadSyncProcess } = require('./fetch_leads_new_api');

// ===================================================================
// CONFIGURATION - MODIFY THESE SETTINGS AS NEEDED
// ===================================================================

const CONFIG = {
    // 🔄 DRY RUN SETTING - SET TO FALSE FOR LIVE DATABASE UPDATES
    isDryRun: false, // Change to false to perform actual database updates
    
    // 📅 HOW FAR BACK TO LOOK FOR UPDATED LEADS
    daysToLookBack: 14,
    
    // 🏢 WHICH BRANCHES TO SYNC (Updated for new Payload system)
    apiBranchIds: [1,2,3,4,5], //[1, 2, 3, 4, 5], // 1=San Bernardino, 2=Kent-WA, 3=Everett-WA, 4=San Diego, 5=Orange County
    
    // 🔍 MATCHING CRITERIA
    matchByName: true,     // Match leads by customer name
    matchByAddress: true,  // Match leads by address
    
    // ⚡ PERFORMANCE SETTING
    skipAlreadyMatchedDBLeads: false // Set to true to skip leads already marked as matched
};

// ===================================================================
// EXECUTION
// ===================================================================

console.log('🚀 Lead Synchronization Script Starting...');
console.log('══════════════════════════════════════════════════════════════');
console.log(`🔄 Mode: ${CONFIG.isDryRun ? 'DRY RUN (No database changes)' : 'LIVE RUN (Database will be updated)'}`);
console.log(`📅 Looking back: ${CONFIG.daysToLookBack} days`);
console.log(`🏢 Branches: ${CONFIG.apiBranchIds.join(', ')}`);
console.log(`🔍 Match by name: ${CONFIG.matchByName ? 'Yes' : 'No'}`);
console.log(`🔍 Match by address: ${CONFIG.matchByAddress ? 'Yes' : 'No'}`);
console.log(`⚡ Skip matched leads: ${CONFIG.skipAlreadyMatchedDBLeads ? 'Yes' : 'No'}`);
console.log('══════════════════════════════════════════════════════════════\n');

if (!CONFIG.isDryRun) {
    console.log('⚠️  WARNING: This is a LIVE RUN - Database will be modified!');
    console.log('⚠️  If you want to test first, set isDryRun: true in the CONFIG section\n');
}

// Add a small delay to let user see the configuration
setTimeout(() => {
    runLeadSyncProcess(CONFIG)
        .then(summary => {
            console.log('\n🎉 SYNC PROCESS COMPLETED!');
            console.log('══════════════════════════════════════════════════════════════');
            
            // Display results with color coding
            summary.logMessages.forEach(msg => {
                if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed') || msg.includes('❌')) {
                    console.error(`❌ ${msg}`);
                } else if (msg.toLowerCase().includes('dry run') || msg.includes('🔄')) {
                    console.log(`\x1b[33m🔄 ${msg}\x1b[0m`); // Yellow for dry run
                } else if (msg.includes('✅') || msg.toLowerCase().includes('success')) {
                    console.log(`\x1b[32m✅ ${msg}\x1b[0m`); // Green for success
                } else if (msg.includes('📊') || msg.includes('ℹ️')) {
                    console.log(`\x1b[36m📊 ${msg}\x1b[0m`); // Cyan for info
                } else {
                    console.log(msg);
                }
            });

            if (summary.errors && summary.errors.length > 0) {
                console.log('\n❌ ERRORS ENCOUNTERED:');
                console.log('══════════════════════════════════════════════════════════════');
                summary.errors.forEach(err => console.error(`❌ ${err}`));
            }
            
            console.log('\n📋 FINAL SUMMARY:');
            console.log('══════════════════════════════════════════════════════════════');
            console.log(`📡 API Leads Fetched: ${summary.apiLeadsFetched}`);
            console.log(`🗄️  DB Leads Scanned: ${summary.dbLeadsScanned}`);
            console.log(`🔗 Matches Found: ${summary.matchesFound}`);
            
            if (CONFIG.isDryRun) {
                console.log(`\x1b[33m🔄 Would Update: ${summary.leadsWouldUpdate || 0} leads\x1b[0m`);
                console.log(`\x1b[33m🔄 Status Changes: ${summary.statusChanges || 0}\x1b[0m`);
                console.log('\n💡 This was a DRY RUN - No changes were made to the database');
                console.log('💡 To perform actual updates, set isDryRun: false in the CONFIG section');
            } else {
                console.log(`\x1b[32m✅ Updated: ${summary.leadsUpdated || 0} leads\x1b[0m`);
                console.log(`\x1b[32m✅ Status Changes: ${summary.statusChanges || 0}\x1b[0m`);
                console.log('\n🎯 LIVE RUN COMPLETED - Database has been updated!');
            }
            
            const successRate = summary.matchesFound > 0 ? ((summary.matchesFound / summary.apiLeadsFetched) * 100).toFixed(1) : '0.0';
            console.log(`📈 Match Rate: ${successRate}% (${summary.matchesFound}/${summary.apiLeadsFetched})`);
            
            console.log('\n✅ Synchronization complete!');
        })
        .catch(error => {
            console.error('\n💥 SYNC PROCESS FAILED!');
            console.error('══════════════════════════════════════════════════════════════');
            console.error('❌ Error:', error.message);
            if (error.stack) {
                console.error('📜 Stack trace:', error.stack);
            }
            process.exit(1);
        });
}, 1000); // 1 second delay to read config 