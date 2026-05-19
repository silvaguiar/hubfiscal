const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist (try-catch for read-only serverless filesystems)
const dirs = ['uploads', 'data', 'exports'];
try {
  dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  });
} catch (err) {
  console.warn('⚠️ Falha ao criar diretórios locais (comum em Vercel/Serverless):', err.message);
}

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Multer config for memory storage (Vercel serverless / Supabase migration)
const storage = multer.memoryStorage();
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

const scheduler = new Scheduler(db);

// Inicialização assíncrona em segundo plano para não travar o carregamento do módulo no Vercel
(async () => {
  try {
    await db.initialize();
    
    // Inicializa o scheduler (timers node-cron) apenas fora do ambiente Vercel
    if (!process.env.VERCEL) {
      await scheduler.inicializar();
    } else {
      console.log('☁️ Ambiente Vercel Serverless detectado. Scheduler ativo apenas para chamadas manuais (node-cron desativado).');
    }
  } catch (err) {
    console.error('❌ Erro na inicialização assíncrona:', err.message);
  }
})();

// ── Auth Routes (públicas) ──────────────────────────────────────
const authRoutes = require('./src/routes/auth.routes');
app.use('/api/auth', authRoutes(db));

// ── Middleware de Auth para todas as demais rotas /api ──────────
const { requireAuth } = require('./src/auth/middleware');

// Desativa cache para todas as requisições na API (resolve problema do F5)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

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
process.on('SIGTERM', () => { if (scheduler && typeof scheduler.parar === 'function') scheduler.parar(); process.exit(0); });
process.on('SIGINT',  () => { if (scheduler && typeof scheduler.parar === 'function') scheduler.parar(); process.exit(0); });

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🟢 HubFiscal rodando em http://localhost:${PORT}\n`);
  });
}

module.exports = app;
