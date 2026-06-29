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

// ── Keep-alive endpoint (público, sem autenticação) ────────────
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), ts: new Date().toISOString() });
});

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

// ── Admin Routes (planos e clientes — master only) ──────────────
const adminRoutes = require('./src/routes/admin.routes');
app.use('/api', adminRoutes(db));

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
    console.log(`\n🟢 SynkFiscal rodando em http://localhost:${PORT}\n`);

    // Auto-ping para evitar standby no Render free tier
    // Funciona enquanto o processo estiver vivo; complemente com UptimeRobot externamente
    if (!process.env.VERCEL) {
      const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
      if (keepAliveUrl) {
        const client = keepAliveUrl.startsWith('https') ? require('https') : require('http');
        const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos
        setInterval(() => {
          client.get(`${keepAliveUrl}/ping`, (res) => {
            console.log(`💓 Keep-alive ping → ${res.statusCode}`);
          }).on('error', (err) => {
            console.warn(`⚠️ Keep-alive ping falhou: ${err.message}`);
          });
        }, PING_INTERVAL_MS);
        console.log(`💓 Keep-alive ativo → ${keepAliveUrl}/ping (a cada 10 min)`);
      } else {
        console.log('ℹ️ Keep-alive desabilitado: defina RENDER_EXTERNAL_URL ou APP_URL no ambiente.');
      }
    }
  });
}

module.exports = app;
