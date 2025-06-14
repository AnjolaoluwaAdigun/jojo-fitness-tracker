const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('./config/passport');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

// Security middleware (Enhanced for production)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.groq.com"], // Allow Groq API calls
    },
  },
  crossOriginEmbedderPolicy: false, // For Railway deployment
}));

// Compression middleware
app.use(compression());

// Enhanced CORS for production deployment
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.CLIENT_URL || 'http://localhost:3000',
      process.env.RAILWAY_STATIC_URL, // Railway frontend URL
      /\.railway\.app$/, // Any Railway subdomain
      /localhost:\d+/, // Any localhost port for development
    ].filter(Boolean);

    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return origin === allowedOrigin;
      }
      return allowedOrigin.test(origin);
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, process.env.NODE_ENV === 'development'); // Allow in dev, block in prod
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Global rate limiting (more lenient for existing app)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // 2000 requests per windowMs (increased for existing functionality)
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for existing routes to avoid breaking changes
  skip: (req) => {
    const skipRoutes = ['/auth', '/api/exercises', '/api/workouts', '/api/progress', '/api/workout-templates', '/api/social'];
    return skipRoutes.some(route => req.path.startsWith(route));
  }
});
app.use(globalLimiter);

// Session configuration for OAuth (Enhanced for production)
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // For Railway HTTPS
  },
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Enhanced health check endpoint for Railway
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    message: 'Fitness Tracker API with JoJo AI is running!',
    features: {
      fitnessTracker: true,
      jojoAI: true,
      socialFeatures: true,
      database: true,
      authentication: true
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version
  });
});

// API health check specifically for JoJo AI
app.get('/api/jojo/health-check', (req, res) => {
  res.json({
    success: true,
    message: 'JoJo AI service is operational',
    timestamp: new Date().toISOString(),
    services: {
      groqAPI: !!process.env.GROQ_API_KEY,
      database: true,
      aiService: true
    }
  });
});

// Existing API routes
app.use('/auth', require('./routes/auth'));
app.use('/api/exercises', require('./routes/exercises'));
app.use('/api/workouts', require('./routes/workouts'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/workout-templates', require('./routes/workout-templates'));
app.use('/api/social', require('./routes/social'));

// JoJo AI Wellness Coach routes
app.use('/api/jojo', require('./routes/jojo'));

// Static file serving
app.use('/uploads', express.static('uploads'));

// Serve React frontend in production (Railway deployment)
if (process.env.NODE_ENV === 'production') {
  // Serve static files from React build
  const frontendBuildPath = path.join(__dirname, '../../client/build');
  
  console.log('🚀 Production mode: Serving React frontend from:', frontendBuildPath);
  
  // Serve static assets with proper caching headers
  app.use(express.static(frontendBuildPath, {
    maxAge: '1d', // Cache static assets for 1 day
    setHeaders: (res, filePath) => {
      // Cache JS and CSS files for longer
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
      }
    }
  }));
  
  // Handle React Router - send all non-API requests to React
  app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.path.startsWith('/uploads/')) {
      return next();
    }
    
    // Send React app for all other routes
    res.sendFile(path.join(frontendBuildPath, 'index.html'), (err) => {
      if (err) {
        console.error('Error serving React app:', err);
        res.status(500).send('Error loading application');
      }
    });
  });
}

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  console.error('Error occurred:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      message: 'A record with this data already exists',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
  
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Record not found',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }
  
  // Rate limiting errors
  if (err.status === 429) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests, please slow down'
    });
  }

  // Groq API errors
  if (err.message && err.message.includes('Groq')) {
    return res.status(503).json({
      success: false,
      message: 'AI service temporarily unavailable',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }

  // Default error handling
  res.status(err.status || 500).json({ 
    success: false,
    message: err.message || 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString()
  });
});

// Enhanced 404 handler for API routes only
app.use('/api/*', (req, res) => {
  res.status(404).json({ 
    success: false,
    message: 'API endpoint not found',
    path: req.path,
    method: req.method,
    availableRoutes: {
      authentication: '/auth/*',
      exercises: '/api/exercises/*',
      workouts: '/api/workouts/*',
      progress: '/api/progress/*',
      workoutTemplates: '/api/workout-templates/*',
      social: '/api/social/*',
      jojoAI: '/api/jojo/*',
      health: '/health'
    },
    timestamp: new Date().toISOString()
  });
});

// Final 404 handler for non-API routes in development
if (process.env.NODE_ENV !== 'production') {
  app.use('*', (req, res) => {
    res.status(404).json({ 
      success: false,
      message: 'Route not found',
      suggestion: 'In production, this would serve the React frontend',
      availableAPIRoutes: {
        auth: '/auth',
        exercises: '/api/exercises',
        workouts: '/api/workouts',
        progress: '/api/progress',
        workoutTemplates: '/api/workout-templates',
        social: '/api/social',
        jojoAI: '/api/jojo',
        health: '/health'
      }
    });
  });
}

module.exports = app;