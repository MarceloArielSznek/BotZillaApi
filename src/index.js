const express = require('express');
require('dotenv').config();
const path = require('path');

const app = express();
const PORT = process.env.PORT;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('API de Botzilla funcionando 🚀');
});

const estimatesRoutes = require('./routes/estimates');
app.use('/api', estimatesRoutes);

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});