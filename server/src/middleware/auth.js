const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Generate JWT token (your existing function)
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

// Your existing JWT middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, username: true, firstName: true, lastName: true }
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

// Your existing session-based auth middleware
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: 'Authentication required' });
};

// NEW: Unified authentication for JoJo (supports both JWT and session)
const authenticateUser = async (req, res, next) => {
  try {
    // First, try JWT authentication
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, email: true, username: true, firstName: true, lastName: true }
        });

        if (user) {
          req.user = user;
          return next();
        }
      } catch (jwtError) {
        console.log('JWT verification failed, trying session auth...');
      }
    }

    // If JWT fails or not provided, try session-based auth
    if (req.isAuthenticated() && req.user) {
      // Ensure we have complete user data from database
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, email: true, username: true, firstName: true, lastName: true }
      });

      if (user) {
        req.user = user;
        return next();
      }
    }

    // If both methods fail
    return res.status(401).json({ 
      success: false, 
      message: 'Authentication required. Please login with a valid token or session.' 
    });

  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication error' 
    });
  }
};

// NEW: Optional authentication (doesn't require login, but attaches user if available)
const optionalAuth = async (req, res, next) => {
  try {
    // Try JWT first
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, email: true, username: true, firstName: true, lastName: true }
        });

        if (user) {
          req.user = user;
          return next();
        }
      } catch (jwtError) {
        // Ignore JWT errors for optional auth
      }
    }

    // Try session auth
    if (req.isAuthenticated() && req.user) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, email: true, username: true, firstName: true, lastName: true }
      });

      if (user) {
        req.user = user;
        return next();
      }
    }

    // No authentication found, but continue (user will be null)
    req.user = null;
    next();
    
  } catch (error) {
    console.error('Optional auth error:', error);
    req.user = null;
    next();
  }
};

// NEW: JoJo-specific auth with enhanced error messages
const authenticateForJoJo = async (req, res, next) => {
  try {
    // Use the unified authentication
    await authenticateUser(req, res, (error) => {
      if (error) {
        return res.status(401).json({
          success: false,
          message: 'JoJo requires authentication. Please login to chat with your wellness coach.',
          action: 'LOGIN_REQUIRED'
        });
      }
      next();
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Unable to authenticate for JoJo chat',
      action: 'RETRY'
    });
  }
};

module.exports = {
  // Your existing exports
  generateToken,
  authenticateToken,
  requireAuth,
  
  // New unified auth methods for JoJo
  authenticateUser,
  optionalAuth,
  authenticateForJoJo
};