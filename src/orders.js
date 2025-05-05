import https from 'https';
import axios from 'axios';
import { default as pLimit } from 'p-limit';
import dotenv from 'dotenv';

dotenv.config();
const usr = process.env.MAGENTO_USERNAME;
const pswr = process.env.MAGENTO_PASSWORD
export function getDateRange(fecha, fechas) {
  let startISO, endISO;
  if (fecha) {
    const [year, month, day] = fecha.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    startISO = startDate.toISOString();
    endISO = endDate.toISOString();
  } else if (fechas) {
    const [fechaInicio, fechaFin] = fechas.split(' al ');
    const [yearStart, startMonth, startDay] = fechaInicio.split('-').map(Number);
    const [yearEnd, endMonth, endDay] = fechaFin.split('-').map(Number);
    const startDate = new Date(Date.UTC(yearStart, startMonth - 1, startDay, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(yearEnd, endMonth - 1, endDay, 23, 59, 59, 999));
    startISO = startDate.toISOString();
    endISO = endDate.toISOString();
  } else {
    const startDate = new Date(Date.UTC(2024, 11, 24, 0, 0, 0, 0));
    const endDate = new Date();
    startISO = startDate.toISOString();
    endISO = endDate.toISOString();
  }
  return { startISO, endISO };
}

export async function loginMagento() {
  try{
  let data = JSON.stringify({ 
    "username": usr, 
    "password": pswr 
  });
  let config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://mcprod.distrinando.com/rest/V1/integration/admin/token',
    headers: { 'Content-Type': 'application/json' },
    data: data
  };
  console.log(process.env)
  console.log(config)
  const rsp = await axios(config);
  return rsp.data;
}catch(e){
  console.log(e)
  return 'error en login magento'
}
}

export async function fetchOrdersFromMagento(startISO, endISO, tkn) {
  const storeIds = [15, 18, 12, 21];
  const ordersArray = [];
  const limit = pLimit(10);
  const startDate = new Date(startISO);
  const endDate = new Date(endISO);

  const promises = storeIds.flatMap(storeId => {
    let currentStartDate = new Date(startDate);
    const storePromises = [];
    while (currentStartDate < endDate) {
      const currentEndDate = new Date(currentStartDate);
      currentEndDate.setUTCDate(currentEndDate.getUTCDate() + 4);
      if (currentEndDate > endDate) currentEndDate.setTime(endDate.getTime());

      const config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `https://mcprod.distrinando.com/rest/V1/orders?searchCriteria[filterGroups][0][filters][0][field]=created_at&searchCriteria[filterGroups][0][filters][0][value]=${currentStartDate.toISOString()}&searchCriteria[filterGroups][0][filters][0][conditionType]=gteq&searchCriteria[filterGroups][1][filters][0][field]=created_at&searchCriteria[filterGroups][1][filters][0][value]=${currentEndDate.toISOString()}&searchCriteria[filterGroups][1][filters][0][conditionType]=lteq&searchCriteria[filterGroups][3][filters][0][field]=store_id&searchCriteria[filterGroups][3][filters][0][value]=${storeId}&searchCriteria[filterGroups][3][filters][0][conditionType]=eq`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tkn}`
        }
      };

      storePromises.push(limit(async () => {
        try {
          const response = await axios(config);
          return response.data.items;
        } catch (e) {
          if (e.response?.status === 503) {
            try {
              const retryResponse = await axios(config);
              return retryResponse.data.items;
            } catch (retryError) {
              return null;
            }
          }
          throw e;
        }
      }));

      currentStartDate.setUTCDate(currentStartDate.getUTCDate() + 4);
    }
    return storePromises;
  });

  const results = await Promise.all(promises);
  results.forEach(items => { if (items) ordersArray.push(...items); });
  return ordersArray;
}

export async function fetchOrdersFromSap(elementos) {
  const rspSap1 = await CheckStatusSap(elementos);
  return rspSap1.filter(item => item !== undefined);
}

export async function CheckStatusSap(elementos) {
  const agent = new https.Agent({ rejectUnauthorized: false });
  const limit = pLimit(5);
  const tkn = await loginSAP();
  const respuestasExitosas = [];
  const promises = elementos.map(entry => limit(async () => {
    try {
      const config = {
        method: 'get',
        maxBodyLength: Infinity,
        httpsAgent: agent,
        url: `https://10.0.0.2:50000/b1s/v2/Orders?$filter=U_WESAP_BaseSysUID eq '${entry}'`,
        headers: {
          'Prefer': 'odata.maxpagesize=500',
          'Cookie': `B1SESSION=${tkn}; ROUTEID=.node3`
        }
      };
      const response = await axios.request(config);
      if (response.data.value.length > 0) {
        response.data.value.forEach(el => {
          if (el.Cancelled !== 'tYES') {
            respuestasExitosas.push({
              DocEntry: el.DocEntry, DocNum: el.DocNum, DocTotal: el.DocTotal,
              CardName: el.CardName, DocumentStatus: el.DocumentStatus,
              U_WESAP_BaseSysUID: el.U_WESAP_BaseSysUID, U_CYGNUS: el.U_CYGNUS
            });
          }
        });
      }
    } catch (error) {
      console.error(`Error en SAP ${entry}:`, error.message);
    }
  }));
  await Promise.all(promises);
  return respuestasExitosas;
}

export async function loginSAP() {
  const agent = new https.Agent({ rejectUnauthorized: false });
  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://10.0.0.2:50000/b1s/v2/Login",
    httpsAgent: agent,
    headers: {
      CompanyDB: "DISTRINANDO",
      UserName: "manager",
      Password: "Ruta#205#"
    }
  };
  const response = await axios.request(config);
  return response.data.SessionId;
}

export function compareOrders(processingOrders, rspSap) {
  const ordersInSap = rspSap.map(order => order.U_WESAP_BaseSysUID);
  return {
    combinedOrders: processingOrders.map(order => {
      const sapOrders = rspSap.filter(sap => sap.U_WESAP_BaseSysUID === order.increment_id);
      const andreaniComments = (order.status_histories || [])
        .filter(h => h.comment?.includes('Andreani'))
        .map(h => h.comment).join('; ');

      const filteredStatusHistories = (order.status_histories || [])
        .filter(h => !h.comment?.includes('Andreani'))
        .map(h => ({ comment: h.comment || 'N/A', created_at: h.created_at || 'N/A', status: h.status || 'N/A' }));

      return {
        created_at: order.created_at || 'N/A',
        clientInfo: `${order.customer_firstname} ${order.customer_lastname}` || 'N/A',
        increment_id: order.increment_id || 'N/A',
        state: order.state || 'N/A',
        status: order.status || 'N/A',
        base_grand_total: order.base_grand_total || 'N/A',
        base_shipping_amount: order.base_shipping_amount || 'N/A',
        base_subtotal: order.base_subtotal || 'N/A',
        store_name: order.store_name || 'N/A',
        updated_at: order.updated_at || 'N/A',
        shipping_description: order.shipping_description || 'N/A',
        andreani_status: andreaniComments || 'N/A',
        status_histories: filteredStatusHistories,
        items: (order.items || []).map(i => ({
          base_price_incl_tax: i.base_price_incl_tax || 'N/A',
          name: i.name || 'N/A',
          sku: i.sku || 'N/A'
        })),
        DocEntries: sapOrders.map(s => s.DocEntry).join(', ') || null,
        DocNums: sapOrders.map(s => s.DocNum).join(', ') || null,
        DocTotal: sapOrders.map(s => s.DocTotal).join(', ') || null,
        CardNames: sapOrders.map(s => s.CardName).join(', ') || null,
        DocumentStatus: sapOrders.map(s => s.DocumentStatus).join(', ') || null,
        U_CYGNUS: sapOrders.map(s => s.U_CYGNUS).join(', ')
      };
    })
  };
}
