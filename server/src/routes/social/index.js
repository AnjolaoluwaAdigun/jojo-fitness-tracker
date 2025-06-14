const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../../middleware/auth');
const { trackActivity, updateOnlineStatus } = require('../../middleware/activityTracking');
const multer = require('multer');
const path = require('path');

const router = express.Router();
const prisma = new PrismaClient();

// Helper function to format user names consistently
const formatUserName = (user) => {
  if (user.firstName && user.lastName) {
    return `${user.firstName} ${user.lastName}`;
  }
  return user.email.split('@')[0];
};

// Helper function to format user avatar
const formatUserAvatar = (user) => {
  if (user.profileImage) {
    return user.profileImage;
  }
  const name = formatUserName(user);
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=64`;
};

// Import sub-routers
const statsRouter = require('./stats');
const challengesRouter = require('./challenges');
const achievementsRouter = require('./achievements');
const friendsRouter = require('./friends');
const leaderboardRouter = require('./leaderboard');

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

// Apply authentication and online status middleware to all routes
router.use(authenticateToken, updateOnlineStatus);

// Mount sub-routers
router.use('/stats', statsRouter);
router.use('/challenges', challengesRouter);
router.use('/achievements', achievementsRouter);
router.use('/friends', friendsRouter);
router.use('/leaderboard', leaderboardRouter);

// Create post route with activity tracking
router.post('/posts', upload.array('media', 5), trackActivity('post'), async (req, res) => {
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
        media: mediaJson,
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

    // Track specific activity types based on post content
    if (type === 'workout' && parsedWorkoutData) {
      // Track workout activity separately
      await trackUserActivity(userId, 'workout', {
        requestData: { workoutData: parsedWorkoutData }
      });
    } else if (type === 'achievement' && parsedAchievementData) {
      // Track achievement activity separately
      await trackUserActivity(userId, 'achievement', {
        requestData: { achievementData: parsedAchievementData }
      });
    }
    
    console.log('🎉 Post created successfully:', post);
    
    // Format response for frontend
    const formattedPost = {
      ...post,
      media: post.media ? JSON.parse(post.media) : [],
      user: {
        ...post.user,
        name: formatUserName(post.user),
        username: `@${post.user.email.split('@')[0]}`,
        avatar: formatUserAvatar(post.user)
      }
    };
    
    res.status(201).json({
      success: true,
      data: { post: formattedPost }
    });
    
  } catch (error) {
    console.error('💥 Error creating post:', error);
    
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
router.get('/posts', async (req, res) => {
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
      take: 20
    });
    
    console.log(`📊 Found ${posts.length} posts`);
    
    const formattedPosts = posts.map(post => ({
      ...post,
      media: post.media ? JSON.parse(post.media) : [],
      likes: post._count.likes || 0,
      comments: post._count.comments || 0,
      shares: 0,
      isLiked: false,
      timestamp: new Date(post.createdAt).toLocaleString(),
      user: {
        ...post.user,
        name: formatUserName(post.user),
        username: `@${post.user.email.split('@')[0]}`,
        avatar: formatUserAvatar(post.user)
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

// Like post route
router.post('/posts/:id/like', trackActivity('like'), async (req, res) => {
  console.log(`👍 POST /posts/${req.params.id}/like called`);
  
  try {
    const userId = req.user.id;
    const postId = req.params.id;

    // Check if post exists
    const post = await prisma.post.findUnique({
      where: { id: postId }
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    // Check if already liked
    const existingLike = await prisma.postLike.findFirst({
      where: {
        userId,
        postId
      }
    });

    let isLiked;
    let likesCount;

    if (existingLike) {
      // Unlike the post
      await prisma.postLike.delete({
        where: { id: existingLike.id }
      });
      isLiked = false;
    } else {
      // Like the post
      await prisma.postLike.create({
        data: {
          userId,
          postId
        }
      });
      isLiked = true;
    }

    // Get updated likes count
    likesCount = await prisma.postLike.count({
      where: { postId }
    });

    res.json({
      success: true,
      data: {
        isLiked,
        likesCount
      }
    });

  } catch (error) {
    console.error('💥 Error liking post:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to like post',
      details: error.message
    });
  }
});

// Share post route
router.post('/posts/:id/share', trackActivity('share'), async (req, res) => {
  console.log(`📤 POST /posts/${req.params.id}/share called`);
  
  try {
    const userId = req.user.id;
    const postId = req.params.id;

    // Check if post exists
    const post = await prisma.post.findUnique({
      where: { id: postId }
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    // Create share record
    await prisma.postShare.create({
      data: {
        userId,
        postId
      }
    });

    // Get updated shares count
    const sharesCount = await prisma.postShare.count({
      where: { postId }
    });

    res.json({
      success: true,
      data: {
        sharesCount
      }
    });

  } catch (error) {
    console.error('💥 Error sharing post:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to share post',
      details: error.message
    });
  }
});

module.exports = router;