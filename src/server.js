require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

// Socket.IO
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }
});
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token'));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    socket.schoolId = decoded.schoolId;
    next();
  } catch { next(new Error('Invalid token')); }
});
io.on('connection', (socket) => {
  socket.join(`school:${socket.schoolId}`);
  socket.on('disconnect', () => {});
});
app.set('io', io);

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] }));

// Rate limiting
const limiter = rateLimit({ windowMs: 15*60*1000, max: 300, message: { success:false, message:'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, message: { success:false, message:'Too many attempts' } });

// Stripe webhook needs raw body BEFORE json parser
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use('/uploads', express.static(path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads')));

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register-school', authLimiter);
app.use('/api/', limiter);

// Routes
app.use('/api', require('./routes'));
app.use('/api/billing', require('./routes/billing.routes'));
app.use('/api/super-admin', require('./routes/super-admin.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));

app.get('/health', (req, res) => res.json({ status:'ok', uptime: process.uptime(), env: process.env.NODE_ENV }));
app.use((req, res) => res.status(404).json({ success:false, message:`Route ${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success:false, message: process.env.NODE_ENV==='development' ? err.message : 'Server error' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🏫 School SaaS v2 running on port ${PORT}`));
module.exports = { app, server, io };

// Super Admin Routes (added)
// app.use('/api/super-admin', require('./routes/super-admin.routes'));
