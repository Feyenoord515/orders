import express from 'express';
import https from 'https';
import axios from 'axios';
import { getDateRange, loginMagento, fetchOrdersFromMagento, fetchOrdersFromSap, compareOrders } from './orders.js';

const app = express();
app.use(express.json());

app.post('/orders', async (req, res) => {
  try {
    const { fecha, fechas, includeSap } = req.body;
    const { startISO, endISO } = getDateRange(fecha, fechas);
    console.log('fechas', startISO)
    const tkn = await loginMagento();
    console.log(tkn)
    if(!tkn){
      
      return 'sin token'
    }
    const items = await fetchOrdersFromMagento(startISO, endISO, tkn);

    if (!items || items.length === 0) {
      return res.status(404).send('No se encontraron pedidos en Magento');
    }

    let combinedOrders = items;

    if (includeSap) {
      const elementos = items.map(item => item.increment_id);
      const rspSap = await fetchOrdersFromSap(elementos);
      const result = compareOrders(items, rspSap);
      combinedOrders = result.combinedOrders;
    }

    combinedOrders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    res.json(combinedOrders);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching orders');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
