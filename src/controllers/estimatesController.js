const https = require('https');

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

exports.fetchEstimates = async (req, res) => {
  const { apiKey, fechaInicio, fechaFin } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'API Key requerida' });
  }

  try {
    const allLeads = await fetchAllEstimates(apiKey, fechaInicio, fechaFin);
    const estimatesFiltrados = extraerDatosBasicos(allLeads);
    res.json(estimatesFiltrados);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}; 