const { Pool } = require('pg');
require('dotenv').config();
const dbPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// Helper para queries genéricos
async function queryDb(query, params = []) {
  const client = await dbPool.connect();
  try {
    const res = await client.query(query, params);
    return res.rows;
  } finally {
    client.release();
  }
}

// --- SALESPEOPLE ---
exports.getAllSalespersons = async (req, res) => {
  res.json(await queryDb('SELECT * FROM salesperson ORDER BY id'));
};
exports.getSalesperson = async (req, res) => {
  const rows = await queryDb('SELECT * FROM salesperson WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
};
exports.createSalesperson = async (req, res) => {
  const { name, telegramid } = req.body;
  const rows = await queryDb('INSERT INTO salesperson (name, telegramid) VALUES ($1, $2) RETURNING *', [name, telegramid || null]);
  res.status(201).json(rows[0]);
};
exports.updateSalesperson = async (req, res) => {
  const { name, telegramid, warning_count } = req.body;
  const rows = await queryDb('UPDATE salesperson SET name=$1, telegramid=$2, warning_count=$3 WHERE id=$4 RETURNING *', [name, telegramid, warning_count, req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
};
exports.deleteSalesperson = async (req, res) => {
  await queryDb('DELETE FROM salesperson WHERE id=$1', [req.params.id]);
  res.json({ success: true });
};

// --- BRANCHES ---
exports.getAllBranches = async (req, res) => {
  res.json(await queryDb('SELECT * FROM branch ORDER BY id'));
};
exports.getBranch = async (req, res) => {
  const rows = await queryDb('SELECT * FROM branch WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
};
exports.createBranch = async (req, res) => {
  const { name } = req.body;
  const rows = await queryDb('INSERT INTO branch (name) VALUES ($1) RETURNING *', [name]);
  res.status(201).json(rows[0]);
};
exports.updateBranch = async (req, res) => {
  const { name } = req.body;
  const rows = await queryDb('UPDATE branch SET name=$1 WHERE id=$2 RETURNING *', [name, req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
};
exports.deleteBranch = async (req, res) => {
  await queryDb('DELETE FROM branch WHERE id=$1', [req.params.id]);
  res.json({ success: true });
};

// --- STATUSES ---
exports.getAllStatuses = async (req, res) => {
  res.json(await queryDb('SELECT * FROM status ORDER BY id'));
};
exports.getStatus = async (req, res) => {
  const rows = await queryDb('SELECT * FROM status WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
};
exports.createStatus = async (req, res) => {
  const { name } = req.body;
  const rows = await queryDb('INSERT INTO status (name) VALUES ($1) RETURNING *', [name]);
  res.status(201).json(rows[0]);
};
exports.updateStatus = async (req, res) => {
  const { name } = req.body;
  const rows = await queryDb('UPDATE status SET name=$1 WHERE id=$2 RETURNING *', [name, req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
};
exports.deleteStatus = async (req, res) => {
  await queryDb('DELETE FROM status WHERE id=$1', [req.params.id]);
  res.json({ success: true });
};

// --- ESTIMATES ---
exports.getAllEstimates = async (req, res) => {
  // Filtros: branch_id, salesperson_id, status_id, from, to
  let q = 'SELECT * FROM estimate WHERE 1=1';
  const params = [];
  if (req.query.branch_id) { params.push(req.query.branch_id); q += ` AND branch_id = $${params.length}`; }
  if (req.query.salesperson_id) { params.push(req.query.salesperson_id); q += ` AND salesperson_id = $${params.length}`; }
  if (req.query.status_id) { params.push(req.query.status_id); q += ` AND status_id = $${params.length}`; }
  if (req.query.from) { params.push(req.query.from); q += ` AND created_date >= $${params.length}`; }
  if (req.query.to) { params.push(req.query.to); q += ` AND created_date <= $${params.length}`; }
  q += ' ORDER BY created_date DESC';
  res.json(await queryDb(q, params));
};
exports.getEstimate = async (req, res) => {
  const rows = await queryDb('SELECT * FROM estimate WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
};
exports.createEstimate = async (req, res) => {
  const { created_date, name, status_id, branch_id, salesperson_id } = req.body;
  const rows = await queryDb('INSERT INTO estimate (created_date, name, status_id, branch_id, salesperson_id) VALUES ($1, $2, $3, $4, $5) RETURNING *', [created_date, name, status_id, branch_id, salesperson_id]);
  res.status(201).json(rows[0]);
};
exports.updateEstimate = async (req, res) => {
  const { created_date, name, status_id, branch_id, salesperson_id } = req.body;
  const rows = await queryDb('UPDATE estimate SET created_date=$1, name=$2, status_id=$3, branch_id=$4, salesperson_id=$5 WHERE id=$6 RETURNING *', [created_date, name, status_id, branch_id, salesperson_id, req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
};
exports.deleteEstimate = async (req, res) => {
  await queryDb('DELETE FROM estimate WHERE id=$1', [req.params.id]);
  res.json({ success: true });
};

// --- ESTIMATES CON DETALLES (para dashboard) ---
exports.getEstimatesWithDetails = async (req, res) => {
  let q = `SELECT e.*, b.name as branch_name, s.name as salesperson_name, st.name as status_name
           FROM estimate e
           LEFT JOIN branch b ON e.branch_id = b.id
           LEFT JOIN salesperson s ON e.salesperson_id = s.id
           LEFT JOIN status st ON e.status_id = st.id
           ORDER BY e.created_date DESC`;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = (page - 1) * limit;
  const paginatedQ = q + ` LIMIT $1 OFFSET $2`;
  const rows = await queryDb(paginatedQ, [limit, offset]);
  // Obtener el total de estimates
  const totalRows = await queryDb('SELECT COUNT(*) FROM estimate');
  res.json({ data: rows, total: parseInt(totalRows[0].count, 10) });
};

// --- SALESPERSONS WITH ACTIVE JOBS ---
exports.getSalespersonsWithActiveJobs = async (req, res) => {
  const result = await queryDb(`
    SELECT s.*, 
      (
        SELECT COUNT(*) 
        FROM estimate e
        JOIN status st ON e.status_id = st.id
        WHERE e.salesperson_id = s.id
          AND st.name IN ('In Progress', 'Released')
      ) AS active_jobs
    FROM salesperson s
    ORDER BY s.id
  `);
  res.json(result);
};

// --- SALESPERSONS WITH >3 WARNINGS FOR MANAGER ---
exports.getSalespersonsWithWarningsForManager = async (req, res) => {
  const result = await queryDb(`
    SELECT s.id, s.name, s.warning_count, b.name AS branch_name,
      (
        SELECT COUNT(*) 
        FROM estimate e
        JOIN status st ON e.status_id = st.id
        WHERE e.salesperson_id = s.id
          AND st.name IN ('In Progress', 'Released')
      ) AS active_jobs
    FROM salesperson s
    LEFT JOIN branch b ON s.branch_id = b.id
    WHERE s.warning_count >= 2 AND s.branch_id = 1
    ORDER BY branch_name
  `);
  console.log('[WARNINGS MANAGER] Result:', result);
  res.json(result);
}; 