import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import axios from 'axios';
import { getDateRange, loginMagento, fetchOrdersFromMagento, fetchOrdersFromSap, compareOrders } from './orders.js';

const app = express();
app.use(express.json());

const jobs = new Map();

app.post('/orders', async (req, res) => {
  const { fecha, fechas, includeSap } = req.body;
  const jobId = uuidv4(); // Genera un identificador único para la solicitud

  // Inicializa el estado del trabajo
  jobs.set(jobId, { status: 'in_progress', results: [] });

  // Procesa las órdenes en segundo plano
  (async () => {
    try {
      const { startISO, endISO } = getDateRange(fecha, fechas);
      const tkn = await loginMagento();
      if (!tkn) {
        jobs.set(jobId, { status: 'error', message: 'Error al obtener el token de Magento' });
        return;
      }

      const items = await fetchOrdersFromMagento(startISO, endISO, tkn);
      if (!items || items.length === 0) {
        jobs.set(jobId, { status: 'completed', results: [], message: 'No se encontraron pedidos en Magento' });
        return;
      }

      let combinedOrders = items;

      if (includeSap) {
        const elementos = items.map(item => item.increment_id);
        const rspSap = await fetchOrdersFromSap(elementos);
        const result = compareOrders(items, rspSap);
        combinedOrders = result.combinedOrders;
      }

      combinedOrders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      jobs.set(jobId, { status: 'completed', results: combinedOrders });
    } catch (error) {
      console.error(error);
      jobs.set(jobId, { status: 'error', message: 'Error procesando las órdenes' });
    }
  })();

  res.json({ jobId, status: 'in_progress' });
});

// Consulta el estado y los resultados de un trabajo
app.get('/orders/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ message: 'Trabajo no encontrado' });
  }

  res.json(job);
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
