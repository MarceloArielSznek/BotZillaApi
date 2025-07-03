const https = require('https');
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

// Función para extraer los datos necesarios de los estimates
function extraerDatosBasicos(leads) {
  return leads.map(lead => ({
    nombre: lead.name,
    branch: lead.user && lead.user.branches && lead.user.branches[0]
      ? lead.user.branches[0].name || lead.user.branches[0].id
      : null,
    fecha_creacion: lead.createdAt,
    estado: lead.status, // Ajusta si el campo de estado tiene otro nombre
    sales_person: lead.user && lead.user.name ? lead.user.name : null
  }));
}

async function fetchAllEstimates(apiKey, fechaInicio, fechaFin) {
  let allLeads = [];
  let page = 1;
  let hasMore = true;
  const pageSize = 100;

  while (hasMore) {
    let queryString = `limit=${pageSize}&page=${page}&depth=2&sort=-updatedAt`;
    if (fechaInicio) {
      queryString += `&where[createdAt][greater_than]=${encodeURIComponent(fechaInicio)}`;
    }
    if (fechaFin) {
      queryString += `&where[createdAt][less_than]=${encodeURIComponent(fechaFin)}`;
    }

    const options = {
      hostname: 'www.attic-tech.com',
      path: `/api/job-estimates?${queryString}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'User-Agent': 'BotzillaApi'
      }
    };

    const leads = await new Promise((resolve, reject) => {
      const req = https.request({ ...options, timeout: 300000 }, (resApi) => {
        let data = '';
        resApi.on('data', chunk => { data += chunk; });
        resApi.on('end', () => {
          if (resApi.statusCode === 200) {
            try {
              const json = JSON.parse(data);
              resolve(json.docs || []);
              hasMore = page < (json.totalPages || 1);
            } catch (e) {
              reject(new Error('Error al parsear la respuesta de la API'));
            }
          } else {
            reject(new Error(`Error de la API externa: ${resApi.statusCode}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('La solicitud a la API externa excedió el tiempo de espera (5 minutos). Prueba con un rango de fechas menor si el problema persiste.'));
      });
      req.end();
    });

    allLeads = allLeads.concat(leads);
    if (leads.length < pageSize) {
      hasMore = false;
    } else {
      page++;
    }
  }
  return allLeads;
}

function logWithTimestamp(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// --- NUEVO ENDPOINT PARA SINCRONIZAR Y GUARDAR EN LA BASE ---
exports.syncEstimates = async (req, res) => {
  const { apiKey } = req.body;
  logWithTimestamp('syncEstimates called');
  // Hardcodear fecha de inicio del sync a 2024-06-15
  const fechaInicioStr = '2025-06-15';
  const fechaFinStr = new Date().toISOString().slice(0, 10); // hoy

  if (!apiKey) {
    return res.status(400).json({ error: 'API Key requerida' });
  }

  const client = await dbPool.connect();
  let inserted = 0, updated = 0, salesPersons = 0, branches = 0, statuses = 0;
  let errors = [];
  try {
    console.log('--- INICIANDO SYNC ESTIMATES ---');
    const allLeads = await fetchAllEstimates(apiKey, fechaInicioStr, fechaFinStr);
    const estimates = extraerDatosBasicos(allLeads);
    console.log(`Estimates a procesar: ${estimates.length}`);
    await client.query('BEGIN');
    const spMap = new Map();
    const branchMap = new Map();
    const statusMap = new Map();
    const spRows = await client.query('SELECT id, name FROM salesperson');
    spRows.rows.forEach(r => spMap.set(r.name, r.id));
    const brRows = await client.query('SELECT id, name FROM branch');
    brRows.rows.forEach(r => branchMap.set(r.name, r.id));
    const stRows = await client.query('SELECT id, name FROM status');
    stRows.rows.forEach(r => statusMap.set(r.name, r.id));
    for (const est of estimates) {
      let spId = null;
      let brId = null;
      if (est.branch) {
        if (!branchMap.has(est.branch)) {
          const brRes = await client.query('INSERT INTO branch (name) VALUES ($1) RETURNING id', [est.branch]);
          brId = brRes.rows[0].id;
          branchMap.set(est.branch, brId);
          branches++;
          console.log(`Nuevo branch: ${est.branch}`);
        } else {
          brId = branchMap.get(est.branch);
        }
      }
      if (est.sales_person) {
        if (!spMap.has(est.sales_person)) {
          const spRes = await client.query('INSERT INTO salesperson (name, branch_id) VALUES ($1, $2) RETURNING id', [est.sales_person, brId]);
          spId = spRes.rows[0].id;
          spMap.set(est.sales_person, spId);
          salesPersons++;
          console.log(`Nuevo salesperson: ${est.sales_person}`);
        } else {
          spId = spMap.get(est.sales_person);
        }
      }
      let stId = null;
      if (est.estado) {
        if (!statusMap.has(est.estado)) {
          const stRes = await client.query('INSERT INTO status (name) VALUES ($1) RETURNING id', [est.estado]);
          stId = stRes.rows[0].id;
          statusMap.set(est.estado, stId);
          statuses++;
          console.log(`Nuevo status: ${est.estado}`);
        } else {
          stId = statusMap.get(est.estado);
        }
      }
      try {
        const upRes = await client.query(
          `INSERT INTO estimate (created_date, name, status_id, branch_id, salesperson_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (name, created_date) DO UPDATE SET status_id = EXCLUDED.status_id, branch_id = EXCLUDED.branch_id, salesperson_id = EXCLUDED.salesperson_id`,
          [est.fecha_creacion, est.nombre, stId, brId, spId]
        );
        if (upRes.rowCount === 1) {
          inserted++;
          console.log(`Insertado: ${est.nombre}`);
        } else {
          updated++;
          console.log(`Actualizado: ${est.nombre}`);
        }
      } catch (e) {
        errors.push(`Estimate ${est.nombre}: ${e.message}`);
        console.error(`Error con estimate ${est.nombre}: ${e.message}`);
      }
    }
    await client.query('INSERT INTO update_log (message) VALUES ($1)', [
      `Sync ejecutado: ${inserted} estimates insertados, ${updated} actualizados, ${salesPersons} salespersons nuevos, ${branches} branches nuevos, ${statuses} estados nuevos.`
    ]);
    await client.query('COMMIT');
    console.log('--- SYNC FINALIZADO ---');
    logWithTimestamp(`syncEstimates finished: ${inserted} inserted, ${updated} updated, ${salesPersons} salespersons, ${branches} branches, ${statuses} statuses`);
    res.json({
      inserted, updated, salesPersons, branches, statuses, total: estimates.length, errors
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error general en sync:', error.message);
    res.status(500).json({ error: error.message, errors });
  } finally {
    client.release();
  }
};

// Endpoint anterior para solo fetch (sin guardar)
exports.fetchEstimates = async (req, res) => {
  const { apiKey } = req.body;
  // Calcular fechas: últimos 15 días
  const fechaFin = new Date();
  const fechaInicio = new Date();
  fechaInicio.setDate(fechaInicio.getDate() - 15);
  const fechaFinStr = fechaFin.toISOString().slice(0, 10);
  const fechaInicioStr = fechaInicio.toISOString().slice(0, 10);

  if (!apiKey) {
    return res.status(400).json({ error: 'API Key requerida' });
  }

  try {
    const allLeads = await fetchAllEstimates(apiKey, fechaInicioStr, fechaFinStr);
    const estimatesFiltrados = extraerDatosBasicos(allLeads);
    res.json(estimatesFiltrados);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Función ficticia para enviar mensajes por Telegram
async function sendTelegram(telegramid, message) {
  // Aquí deberías integrar con la API real de Telegram
  console.log(`[TELEGRAM] Mensaje a ${telegramid}: ${message}`);
}

// Endpoint para enviar advertencias
exports.sendWarnings = async (req, res) => {
  logWithTimestamp('sendWarnings called');
  const client = await dbPool.connect();
  const managerTelegramId = 'MANAGER_TELEGRAM_ID'; // Replace with the real one or fetch from DB
  let felicitar = [];
  try {
    const salespersonsRes = await client.query('SELECT id, name, telegramid, warning_count FROM salesperson');
    let warnings = [];
    for (const sp of salespersonsRes.rows) {
      const countRes = await client.query(
        `SELECT COUNT(*) FROM estimate e
         JOIN status st ON e.status_id = st.id
         WHERE e.salesperson_id = $1 AND st.name IN ('In Progress', 'Released')`,
        [sp.id]
      );
      const total_estimates = parseInt(countRes.rows[0].count);
      let warning_message = null;
      let notify_manager = false;
      let new_warning_count = sp.warning_count;
      if (total_estimates >= 12) {
        new_warning_count++;
        if (new_warning_count === 1) {
          warning_message = `⚠️ URGENT: You have ${total_estimates} active leads ('In Progress' or 'Released'). You MUST reduce this number below 12. Please take action IMMEDIATELY .`;
        } else if (new_warning_count >= 2) {
          warning_message = `FINAL WARNING: You still have ${total_estimates} active leads. Management is being notified. Immediate action is required.`;
          notify_manager = true;
        }
        await client.query('UPDATE salesperson SET warning_count = $1 WHERE id = $2', [new_warning_count, sp.id]);
      } else {
        if (sp.warning_count !== 0) {
          await client.query('UPDATE salesperson SET warning_count = 0 WHERE id = $1', [sp.id]);
          if (sp.telegramid) {
            felicitar.push({ telegramid: sp.telegramid, name: sp.name });
          }
        }
        continue;
      }
      if (sp.telegramid && warning_message) {
        await sendTelegram(sp.telegramid, warning_message);
      }
      if (notify_manager && managerTelegramId) {
        await sendTelegram(managerTelegramId, `Salesperson ${sp.name} has received more than two warnings for having too many active leads.`);
      }
      warnings.push({
        salesperson_name: sp.name,
        telegram_id: sp.telegramid,
        warning_message,
        warning_count: new_warning_count,
        notify_manager
      });
    }
    // Enviar felicitaciones después del escaneo
    let felicitaciones = [];
    for (const f of felicitar) {
      await sendTelegram(
        f.telegramid,
        "🎉 Congratulations! You have reduced your active leads to less than 12. Thank you for your effort and commitment!"
      );
      felicitaciones.push({
        salesperson_name: f.name,
        telegram_id: f.telegramid,
        message: "🎉 Congratulations! You have reduced your active leads to less than 12. Thank you for your effort and commitment!"
      });
    }
    logWithTimestamp(`sendWarnings finished: ${warnings.length} warnings sent`);
    res.json({ warnings, felicitaciones });
  } catch (error) {
    console.error('Error in sendWarnings:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.registerTelegram = async (req, res) => {
  const { telegram_id, salesperson_id } = req.body;
  logWithTimestamp(`registerTelegram called: salesperson_id=${salesperson_id}, telegram_id=${telegram_id}`);
  const client = await dbPool.connect();
  try {
    if (!salesperson_id || !telegram_id) {
      return res.status(400).json({ error: 'Both salesperson_id and telegram_id are required.' });
    }
    // Find salesperson by id
    const spRes = await client.query('SELECT id, name, telegramid FROM salesperson WHERE id = $1', [salesperson_id]);
    if (spRes.rows.length === 0) {
      return res.status(404).json({ error: 'Salesperson not found.' });
    }
    const sp = spRes.rows[0];
    await client.query('UPDATE salesperson SET telegramid = $1 WHERE id = $2', [telegram_id, sp.id]);
    res.json({ message: `Telegram ID registered for ${sp.name}.` });
    logWithTimestamp(`registerTelegram finished: ${sp.name} registered with telegram_id=${telegram_id}`);
  } catch (error) {
    console.error('Error in registerTelegram:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.getSalespersonsList = async (req, res) => {
  logWithTimestamp('getSalespersonsList called');
  const client = await dbPool.connect();
  try {
    const all = await client.query('SELECT id, name FROM salesperson ORDER BY id');
    res.json(all.rows);
    logWithTimestamp(`getSalespersonsList finished: returned ${all.rows.length} salespersons`);
  } catch (error) {
    console.error('Error in getSalespersonsList:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.checkTelegram = async (req, res) => {
  const { telegram_id } = req.body;
  logWithTimestamp(`checkTelegram called: telegram_id=${telegram_id}`);
  if (!telegram_id) {
    return res.status(400).json({ error: 'telegram_id is required.' });
  }
  const client = await dbPool.connect();
  try {
    const result = await client.query('SELECT 1 FROM salesperson WHERE telegramid = $1 LIMIT 1', [telegram_id]);
    res.json({ exists: result.rows.length > 0 });
    logWithTimestamp(`checkTelegram finished: exists=${result.rows.length > 0}`);
  } catch (error) {
    console.error('Error in checkTelegram:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}; 