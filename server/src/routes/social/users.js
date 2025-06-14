const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Get user profile
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        profileImage: true,
        bio: true,
        isOnline: true,
        lastActiveAt: true,
        createdAt: true,
        _count: {
          select: {
            followers: true,
            following: true,
            posts: true,
            workouts: true
          }
        },
        followers: {
          where: { followerId: currentUserId },
          select: { id: true }
        }
      }
    });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }
    
    // Calculate streak (mock for now - you'd implement this based on your workout data)
    const streak = await calculateUserStreak(userId);
    
    res.json({
      success: true,
      data: {
        user: {
          ...user,
          followers: user._count.followers,
          following: user._count.following,
          workouts: user._count.workouts,
          streak,
          isFollowing: user.followers.length > 0,
          achievements: [] // You can populate this from your achievements table
        }
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
});

// Follow/unfollow user
router.post('/:userId/follow', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const followerId = req.user.id;
    
    if (userId === followerId) {
      return res.status(400).json({ 
        success: false, 
        error: 'You cannot follow yourself' 
      });
    }
    
    // Check if already following
    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId: userId }
      }
    });
    
    if (existingFollow) {
      return res.status(400).json({ 
        success: false, 
        error: 'Already following this user' 
      });
    }
    
    // Create follow relationship
    await prisma.follow.create({
      data: {
        followerId,
        followingId: userId
      }
    });
    
    // Create notification
    await prisma.notification.create({
      data: {
        userId,
        fromUserId: followerId,
        type: 'follow',
        title: 'New Follower',
        message: `${req.user.name} started following you`
      }
    });
    
    res.json({
      success: true,
      data: { isFollowing: true }
    });
  } catch (error) {
    console.error('Error following user:', error);
    res.status(500).json({ success: false, error: 'Failed to follow user' });
  }
});

// Unfollow user
router.delete('/:userId/follow', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const followerId = req.user.id;
    
    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId: userId }
      }
    });
    
    if (!existingFollow) {
      return res.status(400).json({ 
        success: false, 
        error: 'Not following this user' 
      });
    }
    
    await prisma.follow.delete({
      where: { id: existingFollow.id }
    });
    
    res.json({
      success: true,
      data: { isFollowing: false }
    });
  } catch (error) {
    console.error('Error unfollowing user:', error);
    res.status(500).json({ success: false, error: 'Failed to unfollow user' });
  }
});

// Get user's followers
router.get('/:userId/followers', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;
    
    const followers = await prisma.follow.findMany({
      where: { followingId: userId },
      include: {
        follower: {
          select: {
            id: true,
            name: true,
            email: true,
            profileImage: true,
            followers: {
              where: { followerId: currentUserId },
              select: { id: true }
            }
          }
        }
      }
    });
    
    const formattedFollowers = followers.map(follow => ({
      ...follow.follower,
      isFollowing: follow.follower.followers.length > 0
    }));
    
    res.json({
      success: true,
      data: { users: formattedFollowers }
    });
  } catch (error) {
    console.error('Error fetching followers:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch followers' });
  }
});

// Get user's following
router.get('/:userId/following', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;
    
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      include: {
        following: {
          select: {
            id: true,
            name: true,
            email: true,
            profileImage: true,
            followers: {
              where: { followerId: currentUserId },
              select: { id: true }
            }
          }
        }
      }
    });
    
    const formattedFollowing = following.map(follow => ({
      ...follow.following,
      isFollowing: follow.following.followers.length > 0
    }));
    
    res.json({
      success: true,
      data: { users: formattedFollowing }
    });
  } catch (error) {
    console.error('Error fetching following:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch following' });
  }
});

// Get user's posts
router.get('/:userId/posts', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    
    const posts = await prisma.post.findMany({
      where: {
        userId,
        OR: [
          { privacy: 'public' },
          { userId: currentUserId }, // Own posts
          { 
            privacy: 'friends',
            user: {
              followers: {
                some: { followerId: currentUserId }
              }
            }
          }
        ]
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            profileImage: true
          }
        },
        likes: {
          where: { userId: currentUserId },
          select: { id: true }
        },
        _count: {
          select: {
            likes: true,
            comments: true,
            shares: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * parseInt(limit),
      take: parseInt(limit)
    });
    
    const formattedPosts = posts.map(post => ({
      ...post,
      isLiked: post.likes.length > 0,
      likes: post._count.likes,
      comments: post._count.comments,
      shares: post._count.shares
    }));
    
    res.json({
      success: true,
      data: {
        posts: formattedPosts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasNext: posts.length === parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching user posts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user posts' });
  }
});

// Search users
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    const currentUserId = req.user.id;
    
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Search query is required' 
      });
    }
    
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: currentUserId } }, // Exclude current user
          {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } }
            ]
          }
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        profileImage: true,
        bio: true,
        followers: {
          where: { followerId: currentUserId },
          select: { id: true }
        },
        _count: {
          select: {
            followers: true,
            workouts: true
          }
        }
      },
      take: parseInt(limit)
    });
    
    const formattedUsers = users.map(user => ({
      ...user,
      isFollowing: user.followers.length > 0,
      followers: user._count.followers,
      workouts: user._count.workouts
    }));
    
    res.json({
      success: true,
      data: { users: formattedUsers }
    });
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ success: false, error: 'Failed to search users' });
  }
});

// Get friend suggestions
router.get('/suggestions', authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { limit = 5 } = req.query;
    
    // Get users that current user is not following
    // This is a simple implementation - you could make it more sophisticated
    // by suggesting mutual friends, people with similar interests, etc.
    const suggestions = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: currentUserId } },
          {
            followers: {
              none: { followerId: currentUserId }
            }
          }
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        profileImage: true,
        bio: true,
        _count: {
          select: {
            followers: true,
            workouts: true
          }
        }
      },
      take: parseInt(limit),
      orderBy: {
        followers: { _count: 'desc' } // Suggest popular users first
      }
    });
    
    const formattedSuggestions = suggestions.map(user => ({
      ...user,
      followers: user._count.followers,
      workouts: user._count.workouts,
      mutualFriends: 0 // You could calculate this with a more complex query
    }));
    
    res.json({
      success: true,
      data: { suggestions: formattedSuggestions }
    });
  } catch (error) {
    console.error('Error fetching suggestions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch suggestions' });
  }
});

// Helper function to calculate user streak
async function calculateUserStreak(userId) {
  try {
    // This is a simplified version - you'd implement this based on your workout data
    // For now, return a mock value
    const recentWorkouts = await prisma.workout.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { createdAt: true }
    });
    
    if (recentWorkouts.length === 0) return 0;
    
    // Calculate consecutive days with workouts
    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    
    const workoutDates = recentWorkouts.map(w => {
      const date = new Date(w.createdAt);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    });
    
    const uniqueDates = [...new Set(workoutDates)].sort((a, b) => b - a);
    
    for (let i = 0; i < uniqueDates.length; i++) {
      const expectedDate = new Date(currentDate.getTime() - (i * 24 * 60 * 60 * 1000));
      if (uniqueDates[i] === expectedDate.getTime()) {
        streak++;
      } else {
        break;
      }
    }
    
    return streak;
  } catch (error) {
    console.error('Error calculating streak:', error);
    return 0;
  }
}

module.exports = router;