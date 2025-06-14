const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../../middleware/auth');
const multer = require('multer');
const path = require('path');

const router = express.Router();
const prisma = new PrismaClient();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/posts/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Create post route with SQLite-compatible media handling
router.post('/', authenticateToken, upload.array('media', 5), async (req, res) => {
  console.log('🚀 POST /posts called');
  console.log('📝 Request body:', req.body);
  console.log('📁 Files:', req.files);
  console.log('👤 User:', req.user);
  
  try {
    const userId = req.user.id;
    const { content, type = 'general', privacy = 'public', location, workoutData, achievementData, challengeData } = req.body;
    
    // Basic validation
    if (!content || content.trim().length === 0) {
      console.log('❌ Validation failed: No content');
      return res.status(400).json({
        success: false,
        error: 'Post content is required'
      });
    }

    // Handle uploaded files - convert array to JSON string for SQLite
    const mediaUrls = req.files ? req.files.map(file => `/uploads/posts/${file.filename}`) : [];
    const mediaJson = mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null;

    // Parse JSON data if it's a string
    let parsedWorkoutData = null;
    let parsedAchievementData = null;
    let parsedChallengeData = null;

    try {
      if (workoutData) {
        parsedWorkoutData = typeof workoutData === 'string' ? JSON.parse(workoutData) : workoutData;
      }
      if (achievementData) {
        parsedAchievementData = typeof achievementData === 'string' ? JSON.parse(achievementData) : achievementData;
      }
      if (challengeData) {
        parsedChallengeData = typeof challengeData === 'string' ? JSON.parse(challengeData) : challengeData;
      }
    } catch (parseError) {
      console.log('❌ JSON parse error:', parseError);
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON data in post fields'
      });
    }
    
    console.log('✅ Creating post with data:', {
      userId,
      content: content.trim(),
      type,
      privacy,
      location,
      media: mediaJson,
      workoutData: parsedWorkoutData,
      achievementData: parsedAchievementData,
      challengeData: parsedChallengeData
    });

    // Create post with media as JSON string for SQLite
    const post = await prisma.post.create({
      data: {
        userId,
        content: content.trim(),
        type,
        privacy,
        location: location || null,
        media: mediaJson, // Store as JSON string, not array
        workoutData: parsedWorkoutData,
        achievementData: parsedAchievementData,
        challengeData: parsedChallengeData
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            profileImage: true
          }
        }
      }
    });
    
    console.log('🎉 Post created successfully:', post);
    
    // Format response for frontend
    const formattedPost = {
      ...post,
      media: post.media ? JSON.parse(post.media) : [], // Parse JSON back to array for frontend
      user: {
        ...post.user,
        name: post.user.firstName && post.user.lastName 
          ? `${post.user.firstName} ${post.user.lastName}` 
          : post.user.email.split('@')[0],
        username: `@${post.user.email.split('@')[0]}`,
        avatar: post.user.profileImage || '/api/placeholder/40/40'
      }
    };
    
    res.status(201).json({
      success: true,
      data: { post: formattedPost }
    });
    
  } catch (error) {
    console.error('💥 Error creating post:', error);
    
    // More specific error handling
    if (error.code === 'P2002') {
      res.status(400).json({
        success: false,
        error: 'Duplicate entry'
      });
    } else if (error.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to create post',
        details: error.message
      });
    }
  }
});

// Get posts route
router.get('/', authenticateToken, async (req, res) => {
  console.log('📖 GET /posts called for user:', req.user.id);
  
  try {
    const posts = await prisma.post.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            profileImage: true
          }
        },
        _count: {
          select: {
            likes: true,
            comments: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    
    console.log(`📊 Found ${posts.length} posts`);
    
    const formattedPosts = posts.map(post => ({
      ...post,
      media: post.media ? JSON.parse(post.media) : [], // Parse media JSON to array
      likes: post._count.likes || 0,
      comments: post._count.comments || 0,
      shares: 0,
      isLiked: false,
      timestamp: new Date(post.createdAt).toLocaleString(),
      user: {
        ...post.user,
        name: post.user.firstName && post.user.lastName 
          ? `${post.user.firstName} ${post.user.lastName}` 
          : post.user.email.split('@')[0],
        username: `@${post.user.email.split('@')[0]}`,
        avatar: post.user.profileImage || '/api/placeholder/40/40'
      }
    }));
    
    res.json({
      success: true,
      data: { posts: formattedPosts }
    });
    
  } catch (error) {
    console.error('💥 Error fetching posts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch posts',
      details: error.message
    });
  }
});

module.exports = router;