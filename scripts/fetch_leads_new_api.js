require('dotenv').config(); // Load .env file variables
const https = require('https');
const { Pool } = require('pg'); // For database interaction

// --- Configuration (Module Level) ---
const API_BRANCH_IDS = [1,2,3,4,5]; // Branch IDs to fetch (updated for new Payload API)
const PAYLOAD_TOKEN = process.env.PAYLOAD_TOKEN;
const API_PAGE_SIZE = 100;
const DRY_RUN = false; // Set to false to perform actual database updates

// DB Status IDs (as per your lead_status table)
const DB_STATUS_SOLD = 1;
const DB_STATUS_LOST = 2;
const DB_STATUS_OPEN = 3;

// API Status mapping
const API_STATUS_MAPPING = {
    'Sold': 'Sold',
    'Lost': 'Lost',
    'In Progress': 'In Progress',
    'Open': 'Open',
    'Pending': 'Open',
    'Released': 'Released',
    'Secondary Estimate': 'Secondary Estimate'
};

const oneYearAgo = new Date();
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
const DATE_FILTER_ISO = oneYearAgo.toISOString();

// Database connection with secure SSL configuration
function getSecureSSLConfig() {
    // If SSL is explicitly disabled, return undefined
    if (process.env.DB_SSL === 'false') {
        return undefined;
    }
    
    // If SSL is not enabled, return undefined (for local development)
    if (process.env.DB_SSL !== 'true') {
        return undefined;
    }

    // Default secure SSL configuration
    const sslConfig = {
        rejectUnauthorized: true // SECURE: Always validate certificates in production
    };

    // Handle development/testing scenarios with self-signed certificates
    if (process.env.NODE_ENV === 'development' && process.env.DB_SSL_ALLOW_SELF_SIGNED === 'true') {
        console.warn('⚠️  DEVELOPMENT MODE: Allowing self-signed certificates - DO NOT USE IN PRODUCTION!');
        sslConfig.rejectUnauthorized = false;
    }

    // Production safety check
    if (process.env.NODE_ENV === 'production' && sslConfig.rejectUnauthorized === false) {
        console.error('❌ CRITICAL SECURITY ERROR: SSL certificate validation is disabled in production!');
        throw new Error('Insecure SSL configuration in production environment');
    }

    return sslConfig;
}

const dbPool = new Pool({
    user: process.env.DB_USER, 
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10),
    ssl: getSecureSSLConfig()
});

// --- Helper Functions ---
function normalizeString(str) {
    if (!str || typeof str !== 'string') return '';
    return str.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()'"]/g, "").replace(/\s+/g, ' ').trim();
}

// Replace the calculateStringSimilarity function with a faster version
function calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();

    // If one string contains the other
    if (str1.includes(str2) || str2.includes(str1)) {
        return 0.9;
    }

    // Split into words
    const words1 = str1.split(' ');
    const words2 = str2.split(' ');
    
    // Count matching words
    const matches = words1.filter(word => words2.includes(word)).length;
    
    // Calculate similarity based on word matches
    const totalWords = Math.max(words1.length, words2.length);
    return matches / totalWords;
}

// --- API Fetching Logic ---
async function fetchAllLeadsFromAPIBranch(branchId, dateFilterIso, logMessages) {
    logMessages.push(`Fetching API leads for Branch ID: ${branchId} (updated since ${dateFilterIso})`);
    let allLeadsForBranch = [];
    let currentPage = 1; // Payload uses 1-based pagination
    let totalLeadsToFetch = 0;
    let leadsFetchedSoFar = 0;

    do {
        // Build query parameters for Payload API
        const queryParams = new URLSearchParams({
            limit: API_PAGE_SIZE,
            page: currentPage,
            depth: 2, // Get branch data
            sort: '-updatedAt',
            'where[createdAt][greater_than]': dateFilterIso,
            'where[user.branches.id][in]': branchId.toString()
        });

        const path = `/api/job-estimates?${queryParams.toString()}`;
        
        const options = {
            hostname: 'www.attic-tech.com',
            path: path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${PAYLOAD_TOKEN}`,
                'Accept': 'application/json',
                'Referer': 'https://www.attic-tech.com/estimates',
                'User-Agent': 'Node.js Leads Sync Script'
            }
        };

        try {
            const jsonData = await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            try { 
                                resolve(JSON.parse(data)); 
                            } catch (e) { 
                                logMessages.push(`Branch ${branchId} - JSON Parse Error: ${e.message}`);
                                reject(e); 
                            }
                        } else {
                            logMessages.push(`Branch ${branchId} - API Error. Status: ${res.statusCode}, Data: ${data.substring(0, 200)}`);
                            reject(new Error(`API request for Branch ${branchId} failed: ${res.statusCode}`));
                        }
                    });
                });
                req.on('error', (e) => { 
                    logMessages.push(`Branch ${branchId} - Request Error: ${e.message}`);
                    reject(e); 
                });
                req.end();
            });

            if (jsonData.docs && Array.isArray(jsonData.docs)) {
                // Filter docs to only include those with the specified branch
                const branchFilteredDocs = jsonData.docs.filter(doc => {
                    if (!doc.user || !doc.user.branches || !Array.isArray(doc.user.branches)) {
                        return false;
                    }
                    return doc.user.branches.some(branch => branch.id === branchId);
                });

                branchFilteredDocs.forEach(lead => {
                    // Add T&M logging
                    const tmValue = parseFloat(lead.true_cost) || 0.00;
                    logMessages.push(`Lead ID: ${lead.id}, Name: ${lead.name}, T&M Value: $${tmValue.toFixed(2)}`);
                    allLeadsForBranch.push(lead);
                });
                leadsFetchedSoFar += branchFilteredDocs.length;

                if (currentPage === 1) {
                    // Estimate total based on current page results
                    totalLeadsToFetch = jsonData.totalDocs || branchFilteredDocs.length;
                    logMessages.push(`Branch ${branchId} - Total API leads to fetch (matching criteria): ${totalLeadsToFetch}`);
                }
                
                logMessages.push(`Branch ${branchId} - Page ${currentPage}: Fetched ${branchFilteredDocs.length} (${jsonData.docs.length} total in page). So far: ${leadsFetchedSoFar}`);
                
                // Check if we should continue
                if (!jsonData.docs.length || currentPage >= (jsonData.totalPages || 1)) {
                    break;
                }
            } else {
                logMessages.push(`Branch ${branchId} - No docs array or unexpected format for page ${currentPage}.`);
                break;
            }
            
            currentPage++;
            
            // Rate limiting between requests
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            logMessages.push(`Branch ${branchId} - Error fetching page ${currentPage}: ${error.message}`);
            break; 
        }
    } while (currentPage <= 50); // Safety limit to prevent infinite loops
    
    logMessages.push(`Finished API fetch for Branch ${branchId}. Retrieved ${allLeadsForBranch.length} leads.`);
    return allLeadsForBranch;
}

// --- Database Fetching Logic ---
async function fetchAllLeadsFromDB(skipAlreadyMatchedDBLeads, logMessages) {
    logMessages.push('Fetching leads from the local database...');
    let query = `
        SELECT
            l.id as db_lead_id, l.name as db_lead_name, l.lead_status_id,
            l.sub_contractor_price, l.proposal_tm, l.matched,
            l.at_price, l.at_status, l.last_update_date,
            c.first_name, c.last_name,
            a.street as db_street, a.city as db_city, a.state as db_state, a.zip_code as db_zip_code
        FROM leads_dashboard.lead l
        LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
        LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
    `;
    if (skipAlreadyMatchedDBLeads) {
        query += ' WHERE (l.matched = false OR l.matched IS NULL)';
    }
    query += ' ORDER BY l.id;';
    
    let client;
    try {
        client = await dbPool.connect();
        const { rows } = await client.query(query);
        logMessages.push(`Fetched ${rows.length} leads from the database.` + (skipAlreadyMatchedDBLeads ? ' (skipped already matched leads)' : ''));
        return rows;
    } catch (error) {
        logMessages.push(`Error fetching leads from database: ${error.message}`);
        return [];
    } finally {
        if (client) client.release();
    }
}

// Add this function before runLeadSyncProcess
function createNameIndex(dbLeads) {
    const nameIndex = new Map();
    for (const lead of dbLeads) {
        const normalizedName = normalizeString(lead.db_lead_name);
        if (!nameIndex.has(normalizedName)) {
            nameIndex.set(normalizedName, []);
        }
        nameIndex.get(normalizedName).push(lead);
    }
    return nameIndex;
}

function createAddressIndex(dbLeads) {
    const addressIndex = new Map();
    for (const lead of dbLeads) {
        const fullAddress = normalizeString(`${lead.db_street || ''} ${lead.db_city || ''} ${lead.db_state || ''}`.trim());
        if (fullAddress && fullAddress.length > 5) {
            // Index by first 5 characters of address
            const addressKey = fullAddress.substring(0, 5);
            if (!addressIndex.has(addressKey)) {
                addressIndex.set(addressKey, []);
            }
            addressIndex.get(addressKey).push({
                lead,
                fullAddress
            });
        }
    }
    return addressIndex;
}

// --- Main Sync Process Function ---
async function runLeadSyncProcess(config) {
    const resultsSummary = {
        logMessages: [],
        errors: [],
        apiLeadsFetched: 0,
        dbLeadsScanned: 0,
        matchesFound: 0,
        leadsUpdated: 0,
        statusChanges: 0,
        leadsWouldUpdate: 0
    };

    const logMessages = resultsSummary.logMessages;
    
    const { 
        daysToLookBack, 
        apiBranchIds,
        matchByName, 
        matchByAddress, 
        skipAlreadyMatchedDBLeads, 
        isDryRun 
    } = config;

    resultsSummary.logMessages.push('Starting API and DB lead synchronization process...');
    resultsSummary.logMessages.push(`Dry Run: ${isDryRun}`);
    resultsSummary.logMessages.push(`Configuration: Days Back=${daysToLookBack}, Branches=${apiBranchIds.join(',')}, MatchByName=${matchByName}, MatchByAddress=${matchByAddress}, SkipMatched=${skipAlreadyMatchedDBLeads}`);

    const dateFilter = new Date();
    dateFilter.setDate(dateFilter.getDate() - daysToLookBack);
    const dateFilterIso = dateFilter.toISOString();

    resultsSummary.logMessages.push(`Fetching API leads updated since: ${dateFilterIso}`);
    
    let allApiLeadsCombined = [];
    for (const branchId of apiBranchIds) {
        try {
            const branchApiLeads = await fetchAllLeadsFromAPIBranch(branchId, dateFilterIso, resultsSummary.logMessages);
            allApiLeadsCombined.push(...branchApiLeads);
        } catch (e) {
            resultsSummary.errors.push(`Failed to fetch leads for branch ${branchId}: ${e.message}`);
        }
    }
    resultsSummary.apiLeadsFetched = allApiLeadsCombined.length;
    resultsSummary.logMessages.push(`Total API leads fetched from all configured branches: ${resultsSummary.apiLeadsFetched}`);

    // Sub contractor cost analysis
    let leadsWithSubCostCount = 0;
    let leadsWithPositiveSubCostCount = 0;
    allApiLeadsCombined.forEach(apiLead => {
        if (apiLead.sub_services_retail_cost !== null && apiLead.sub_services_retail_cost !== undefined) {
            leadsWithSubCostCount++;
            if (parseFloat(apiLead.sub_services_retail_cost) > 0) {
                leadsWithPositiveSubCostCount++;
            }
        }
    });
    resultsSummary.logMessages.push(`--- API Lead Sub Contractor Cost Analysis ---`);
    resultsSummary.logMessages.push(`Number of API leads with a sub_services_retail_cost value (non-null): ${leadsWithSubCostCount}`);
    resultsSummary.logMessages.push(`Number of API leads with a sub_services_retail_cost value > 0: ${leadsWithPositiveSubCostCount}`);

    const allDbLeads = await fetchAllLeadsFromDB(skipAlreadyMatchedDBLeads, resultsSummary.logMessages);
    resultsSummary.dbLeadsScanned = allDbLeads.length;

    if (!allApiLeadsCombined.length) {
        resultsSummary.logMessages.push('No API leads fetched. Exiting comparison and update process.');
        return resultsSummary;
    }
    if (!allDbLeads.length && !skipAlreadyMatchedDBLeads) {
        resultsSummary.logMessages.push('No DB leads fetched. Exiting comparison and update process.');
        return resultsSummary;
    }
    if (!allDbLeads.length && skipAlreadyMatchedDBLeads) {
        resultsSummary.logMessages.push('No DB leads fetched (possibly all were already matched and skipped).');
        return resultsSummary;
    }

    const matchedDbLeadIds = new Set(); 

    resultsSummary.logMessages.push('Starting comparison and immediate update processing...');
    
    // Add T&M analysis section
    let tmAnalysis = {
        total: 0,
        withTM: 0,
        withoutTM: 0,
        totalTMValue: 0
    };

    resultsSummary.logMessages.push('Creating search indexes for faster matching...');
    const nameIndex = createNameIndex(allDbLeads);
    const addressIndex = createAddressIndex(allDbLeads);
    resultsSummary.logMessages.push(`Created indexes: ${nameIndex.size} unique names, ${addressIndex.size} address prefixes`);

    for (const apiLead of allApiLeadsCombined) {
        const normalizedApiName = normalizeString(apiLead.name);
        const normalizedApiAddress = normalizeString(apiLead.address);

        for (const dbLead of allDbLeads) {
            if (matchedDbLeadIds.has(dbLead.db_lead_id)) continue;

            const normalizedDbLeadName = normalizeString(dbLead.db_lead_name);
            const fullDbAddress = normalizeString(`${dbLead.db_street || ''} ${dbLead.db_city || ''} ${dbLead.db_state || ''}`.trim());

            let isMatch = false;
            let matchType = '';

            // Match by Name
            if (matchByName && normalizedApiName && normalizedDbLeadName && normalizedApiName === normalizedDbLeadName) {
                isMatch = true;
                matchType = 'Name';
            }
            // Match by Address
            else if (matchByAddress && normalizedApiAddress && fullDbAddress) {
                if (normalizedApiAddress.length > 5 && fullDbAddress.length > 5 && 
                    (normalizedApiAddress.includes(fullDbAddress) || fullDbAddress.includes(normalizedApiAddress))) {
                    isMatch = true;
                    matchType = 'Address';
                }
            }

            if (isMatch) {
                resultsSummary.matchesFound++;
                matchedDbLeadIds.add(dbLead.db_lead_id);
                
                // Update the lead
                if (!isDryRun) {
                    try {
                        const updateQuery = `
                            UPDATE leads_dashboard.lead 
                            SET 
                                proposal_tm = $1,
                                final_proposal_amount = $2,
                                last_update_date = NOW(),
                                updated_at = NOW()
                            WHERE id = $3
                        `;
                        const tmValue = parseFloat(apiLead.true_cost) || 0.00;
                        const finalValue = parseFloat(apiLead.total_cost) || 0.00;
                        const updateValues = [
                            tmValue,
                            finalValue,
                            dbLead.db_lead_id
                        ];
                        await dbPool.query(updateQuery, updateValues);
                        resultsSummary.leadsUpdated++;
                        resultsSummary.logMessages.push(`✅ Updated DB Lead ID ${dbLead.db_lead_id} with T&M value: $${tmValue.toFixed(2)}`);
                    } catch (updateError) {
                        resultsSummary.errors.push(`Error updating DB Lead ID ${dbLead.db_lead_id}: ${updateError.message}`);
                    }
                }
                break; // Found a match, move to next API lead
            }
        }
    }

    // Add T&M summary to logs
    logMessages.push('\n=== T&M Analysis ===');
    logMessages.push(`Total Leads Processed: ${tmAnalysis.total}`);
    logMessages.push(`Leads with T&M: ${tmAnalysis.withTM}`);
    logMessages.push(`Leads without T&M: ${tmAnalysis.withoutTM}`);
    logMessages.push(`Average T&M Value: $${(tmAnalysis.totalTMValue / tmAnalysis.withTM).toFixed(2)}`);
    logMessages.push('==================\n');

    resultsSummary.logMessages.push('--- Synchronization Summary ---');
    resultsSummary.logMessages.push(`Total API leads fetched: ${resultsSummary.apiLeadsFetched}`);
    resultsSummary.logMessages.push(`Total DB leads scanned` + (skipAlreadyMatchedDBLeads ? ' (excluding already matched)' : '') + `: ${resultsSummary.dbLeadsScanned}`);
    resultsSummary.logMessages.push(`Number of API leads that found a match in DB: ${resultsSummary.matchesFound}`);
    if (isDryRun) {
        resultsSummary.logMessages.push(`Number of DB leads that WOULD BE updated (Dry Run): ${resultsSummary.leadsWouldUpdate}`);
        resultsSummary.logMessages.push(`Number of DB leads that WOULD HAVE status changed (Dry Run): ${resultsSummary.statusChanges}`);
    } else {
        resultsSummary.logMessages.push(`Number of DB leads updated: ${resultsSummary.leadsUpdated}`);
        resultsSummary.logMessages.push(`Number of DB leads that HAD status changed: ${resultsSummary.statusChanges}`);
    }
    if(resultsSummary.errors.length > 0){
        resultsSummary.logMessages.push(`Encountered ${resultsSummary.errors.length} errors during the process. Check 'errors' array in summary for details.`);
    }
    resultsSummary.logMessages.push('Lead synchronization process finished.');
    return resultsSummary;
}

module.exports = { runLeadSyncProcess };

// Block for manual execution
if (require.main === module) {
    console.log("Running fetch_leads_new_api.js script manually...");
    // Define a default configuration for manual runs
    const defaultConfig = {
        daysToLookBack: 30, 
        apiBranchIds: [1, 2, 3, 4, 5], // Updated branch IDs for new Payload API
        matchByName: true,
        matchByAddress: true,
        skipAlreadyMatchedDBLeads: false,
        isDryRun: true // ALWAYS default to dry run for safety in manual execution
    };

    console.log("Using default manual configuration:", JSON.stringify(defaultConfig, null, 2));

    runLeadSyncProcess(defaultConfig)
        .then(summary => {
            console.log("\n--- MANUAL EXECUTION COMPLETE ---");
            console.log("Log Messages:");
            summary.logMessages.forEach(msg => {
                if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed')) {
                    console.error(msg);
                } else if (msg.toLowerCase().includes('dry run')) {
                    console.warn(msg);
                } else {
                    console.log(msg);
                }
            });

            if (summary.errors && summary.errors.length > 0) {
                console.error("\n--- ERRORS ENCOUNTERED ---");
                summary.errors.forEach(err => console.error(err));
            }
            
            console.log("\n--- FINAL SUMMARY (from returned object) ---");
            console.log(`  API Leads Fetched: ${summary.apiLeadsFetched}`);
            console.log(`  DB Leads Scanned: ${summary.dbLeadsScanned}`);
            console.log(`  Matches Found: ${summary.matchesFound}`);
            if (summary.hasOwnProperty('leadsWouldUpdate')) {
                 console.log(`  Leads Would Be Updated (Dry Run): ${summary.leadsWouldUpdate}`);
            }
            if (summary.hasOwnProperty('leadsUpdated')) {
                console.log(`Leads Updated (Live Run): ${summary.leadsUpdated}`);
            }
            if (summary.hasOwnProperty('statusChanges')) {
                console.log(`Status Changes (would occur or did occur): ${summary.statusChanges}`);
            }
        });
}