const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
const dirs = ['uploads', 'data', 'exports'];
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Multer config for certificate upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, 'certificado.pfx')
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.pfx') {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos .pfx são aceitos'));
    }
  }
});

// Database initialization & server start
const db = require('./src/database/db');
const Scheduler = require('./src/scheduler/scheduler');

(async () => {
  await db.initialize();

  // Inicializar o scheduler de agendamentos
  const scheduler = new Scheduler(db);
  await scheduler.inicializar();

  // ── Auth Routes (públicas) ──────────────────────────────────────
  const authRoutes = require('./src/routes/auth.routes');
  app.use('/api/auth', authRoutes(db));

  // ── Middleware de Auth para todas as demais rotas /api ──────────
  const { requireAuth } = require('./src/auth/middleware');
  app.use('/api', requireAuth);

  // ── API Routes (protegidas) ─────────────────────────────────────
  const apiRoutes = require('./src/routes/api');
  app.use('/api', apiRoutes(db, upload));

  // ── Users Routes ────────────────────────────────────────────────
  const usersRoutes = require('./src/routes/users.routes');
  app.use('/api/usuarios', usersRoutes(db));

  // ── Agendamentos Routes ─────────────────────────────────────────
  const agendamentosRoutes = require('./src/routes/agendamentos.routes');
  app.use('/api/agendamentos', agendamentosRoutes(db, scheduler));

  // ── SPA: login é rota pública, dashboard requer auth ───────────
  app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Graceful shutdown
  process.on('SIGTERM', () => { scheduler.parar(); process.exit(0); });
  process.on('SIGINT',  () => { scheduler.parar(); process.exit(0); });

  app.listen(PORT, () => {
    console.log(`\n🟢 HubFiscal rodando em http://localhost:${PORT}\n`);
  });
})();
