require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("🚀 Backend de WorldChange funcionando correctamente!");
});

// Ruta de prueba: obtener lista de usuarios
app.get("/api/usuarios", (req, res) => {
  const usuarios = [
    { nombre: "Laura Gómez", correo: "laura@correo.com" },
    { nombre: "Carlos Ruiz", correo: "carlos@correo.com" },
    { nombre: "Sofía Torres", correo: "sofia@correo.com" },
  ];
  res.json(usuarios);
});


const DATABASE_URL = process.env.DATABASE_URL || null;
let pool = null;
const useJsonFallback = !DATABASE_URL;

if (!useJsonFallback) {
  pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  // try to init table
  (async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          world_id_hash TEXT NOT NULL,
          type TEXT NOT NULL,
          amount_wld NUMERIC(18,8) NOT NULL,
          amount_cop NUMERIC(18,2) NOT NULL,
          status TEXT DEFAULT 'OPEN',
          counterparty_contact TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
    } finally {
      client.release();
    }
  })().catch(e => console.error('DB init error', e));
} else {
  // JSON fallback file
  const dataFile = path.join(__dirname, 'db.json');
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify({ orders: [], lastId:0 }, null, 2));
}

function readJsonDB() {
  const p = path.join(__dirname, 'db.json');
  const raw = fs.readFileSync(p);
  return JSON.parse(raw);
}
function writeJsonDB(obj) {
  const p = path.join(__dirname, 'db.json');
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

// List orders
app.get('/api/orders', async (req, res) => {
  try {
    if (!useJsonFallback) {
      const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
      return res.json(rows);
    } else {
      const db = readJsonDB();
      return res.json(db.orders.reverse());
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

// Create order
app.post('/api/orders', async (req, res) => {
  try {
    const { world_id_hash, type, amount_wld, amount_cop, counterparty_contact } = req.body;
    if (!world_id_hash || !type || !amount_wld || !amount_cop) return res.status(400).json({ message: 'missing fields' });
    if (!useJsonFallback) {
      const { rows } = await pool.query(
        'INSERT INTO orders (world_id_hash, type, amount_wld, amount_cop, status, counterparty_contact) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [world_id_hash, type, amount_wld, amount_cop, 'OPEN', counterparty_contact || null]
      );
      return res.json(rows[0]);
    } else {
      const db = readJsonDB();
      const id = db.lastId + 1;
      db.lastId = id;
      const order = { id, world_id_hash, type, amount_wld, amount_cop, status:'OPEN', counterparty_contact: counterparty_contact || null, created_at: new Date().toISOString() };
      db.orders.push(order);
      writeJsonDB(db);
      return res.json(order);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

// Update status
app.put('/api/orders/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, counterparty_contact } = req.body;
    if (!useJsonFallback) {
      const { rowCount } = await pool.query('UPDATE orders SET status=$1, counterparty_contact=$2 WHERE id=$3', [status, counterparty_contact || null, id]);
      return res.json({ affected: rowCount });
    } else {
      const db = readJsonDB();
      const idx = db.orders.findIndex(o => o.id === id);
      if (idx === -1) return res.status(404).json({ message: 'not found' });
      if (status) db.orders[idx].status = status;
      if (counterparty_contact) db.orders[idx].counterparty_contact = counterparty_contact;
      writeJsonDB(db);
      return res.json(db.orders[idx]);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

// Simple health
app.get('/api/ping', (req,res)=>res.json({ ok:true, env: useJsonFallback ? 'demo-json' : 'postgres' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));

