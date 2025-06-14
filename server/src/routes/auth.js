const express = require('express');
const passport = require('../config/passport');
const { generateToken, authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Google OAuth routes
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    // Successful authentication
    const token = generateToken(req.user.id);
    
    // Redirect to frontend with token
    res.redirect(`${process.env.CLIENT_URL}/auth/success?token=${token}`);
  }
);

// Get current user info (protected route)
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    user: req.user,
    message: 'User profile retrieved successfully'
  });
});

// Logout
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: 'Error logging out' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// Test protected route
router.get('/protected', authenticateToken, (req, res) => {
  res.json({
    message: 'This is a protected route!',
    user: req.user
  });
});

module.exports = router;