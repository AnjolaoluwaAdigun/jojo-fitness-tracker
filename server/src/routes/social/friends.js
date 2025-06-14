const express = require('express');
const { PrismaClient } = require('@prisma/client');

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

// GET /api/social/friends - Get user's friends list
router.get('/', async (req, res) => {
  console.log('👥 GET /friends called for user:', req.user.id);
  
  try {
    const userId = req.user.id;

    // Get all accepted friendships where user is either follower or following
    const friendships = await prisma.follow.findMany({
      where: {
        OR: [
          { followerId: userId },
          { followingId: userId }
        ]
      },
      include: {
        follower: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            profileImage: true,
            isOnline: true,
            lastSeen: true,
            status: true
          }
        },
        following: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            profileImage: true,
            isOnline: true,
            lastSeen: true,
            status: true
          }
        }
      }
    });

    // Format friends list (get the "other" person in each friendship)
    const friends = friendships.map(friendship => {
      const friend = friendship.followerId === userId ? friendship.following : friendship.follower;
      return {
        id: friend.id,
        name: formatUserName(friend),
        email: friend.email,
        avatar: formatUserAvatar(friend),
        isOnline: friend.isOnline,
        lastSeen: friend.lastSeen,
        status: friend.status,
        followedAt: friendship.createdAt,
        isFollowing: friendship.followerId === userId,
        isFollower: friendship.followingId === userId
      };
    });

    // Get mutual friends count for each friend
    const friendsWithStats = await Promise.all(
      friends.map(async (friend) => {
        // Count mutual friends
        const mutualFriends = await prisma.follow.count({
          where: {
            OR: [
              {
                followerId: friend.id,
                following: {
                  followers: {
                    some: { followerId: userId }
                  }
                }
              },
              {
                followingId: friend.id,
                follower: {
                  following: {
                    some: { followingId: userId }
                  }
                }
              }
            ]
          }
        });

        // Get recent workout count
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        
        const recentWorkouts = await prisma.workout.count({
          where: {
            userId: friend.id,
            date: {
              gte: oneWeekAgo
            }
          }
        });

        return {
          ...friend,
          mutualFriends,
          recentWorkouts
        };
      })
    );

    console.log(`👥 Found ${friendsWithStats.length} friends`);

    res.json({
      success: true,
      data: {
        friends: friendsWithStats,
        total: friendsWithStats.length
      }
    });

  } catch (error) {
    console.error('💥 Error fetching friends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch friends',
      details: error.message
    });
  }
});

// GET /api/social/friends/online - Get online friends
router.get('/online', async (req, res) => {
  console.log('👥 GET /friends/online called for user:', req.user.id);
  
  try {
    const userId = req.user.id;
    const fiveMinutesAgo = new Date();
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

    // Get friends who have been active in the last 5 minutes
    const onlineFriends = await prisma.user.findMany({
      where: {
        OR: [
          {
            followers: {
              some: {
                followerId: userId
              }
            }
          },
          {
            following: {
              some: {
                followingId: userId
              }
            }
          }
        ],
        lastSeen: {
          gte: fiveMinutesAgo
        },
        isOnline: true
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        profileImage: true,
        status: true,
        lastSeen: true,
        isOnline: true
      },
      take: 20,
      orderBy: {
        lastSeen: 'desc'
      }
    });

    const formattedFriends = onlineFriends.map(friend => ({
      id: friend.id,
      name: formatUserName(friend),
      avatar: formatUserAvatar(friend),
      status: friend.status || 'Online',
      isOnline: friend.isOnline,
      lastSeen: friend.lastSeen
    }));

    console.log(`👥 Found ${formattedFriends.length} online friends`);

    res.json({
      success: true,
      data: {
        friends: formattedFriends
      }
    });

  } catch (error) {
    console.error('💥 Error fetching online friends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch online friends',
      details: error.message
    });
  }
});

// GET /api/social/friends/suggestions - Get friend suggestions
router.get('/suggestions', async (req, res) => {
  console.log('💡 GET /friends/suggestions called for user:', req.user.id);
  
  try {
    const userId = req.user.id;

    // Get current friends
    const currentFriends = await prisma.follow.findMany({
      where: {
        OR: [
          { followerId: userId },
          { followingId: userId }
        ]
      },
      select: {
        followerId: true,
        followingId: true
      }
    });

    const friendIds = [
      ...currentFriends.map(f => f.followerId),
      ...currentFriends.map(f => f.followingId)
    ].filter(id => id !== userId);

    // Find users who are friends with current friends (mutual connections)
    const suggestions = await prisma.user.findMany({
      where: {
        id: {
          notIn: [...friendIds, userId] // Exclude current friends and self
        },
        OR: [
          {
            followers: {
              some: {
                followerId: {
                  in: friendIds
                }
              }
            }
          },
          {
            following: {
              some: {
                followingId: {
                  in: friendIds
                }
              }
            }
          }
        ]
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        profileImage: true,
        isOnline: true,
        createdAt: true
      },
      take: 10,
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Add mutual friends count and recent activity
    const suggestionsWithStats = await Promise.all(
      suggestions.map(async (user) => {
        // Count mutual friends
        const mutualFriends = await prisma.follow.count({
          where: {
            OR: [
              {
                followerId: user.id,
                following: {
                  followers: {
                    some: { followerId: userId }
                  }
                }
              },
              {
                followingId: user.id,
                follower: {
                  following: {
                    some: { followingId: userId }
                  }
                }
              }
            ]
          }
        });

        // Get recent posts count
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        
        const recentPosts = await prisma.post.count({
          where: {
            userId: user.id,
            createdAt: {
              gte: oneWeekAgo
            }
          }
        });

        return {
          id: user.id,
          name: formatUserName(user),
          email: user.email,
          avatar: formatUserAvatar(user),
          isOnline: user.isOnline,
          mutualFriends,
          recentPosts,
          joinedDate: user.createdAt
        };
      })
    );

    console.log(`💡 Found ${suggestionsWithStats.length} friend suggestions`);

    res.json({
      success: true,
      data: {
        suggestions: suggestionsWithStats
      }
    });

  } catch (error) {
    console.error('💥 Error fetching friend suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch friend suggestions',
      details: error.message
    });
  }
});

// POST /api/social/friends/:id/follow - Follow a user
router.post('/:id/follow', async (req, res) => {
  console.log(`👥 POST /friends/${req.params.id}/follow called`);
  
  try {
    const userId = req.user.id;
    const targetUserId = req.params.id;

    if (userId === targetUserId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot follow yourself'
      });
    }

    // Check if target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId }
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if already following
    const existingFollow = await prisma.follow.findFirst({
      where: {
        followerId: userId,
        followingId: targetUserId
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
        followerId: userId,
        followingId: targetUserId
      }
    });

    // Create notification for the followed user
    await prisma.notification.create({
      data: {
        userId: targetUserId,
        type: 'follow',
        title: 'New Follower',
        message: `${formatUserName(req.user)} started following you`,
        fromUserId: userId
      }
    });

    console.log(`✅ User ${userId} followed ${targetUserId}`);

    res.json({
      success: true,
      data: {
        message: 'Successfully followed user'
      }
    });

  } catch (error) {
    console.error('💥 Error following user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to follow user',
      details: error.message
    });
  }
});

// DELETE /api/social/friends/:id/unfollow - Unfollow a user
router.delete('/:id/unfollow', async (req, res) => {
  console.log(`👥 DELETE /friends/${req.params.id}/unfollow called`);
  
  try {
    const userId = req.user.id;
    const targetUserId = req.params.id;

    // Find and delete follow relationship
    const existingFollow = await prisma.follow.findFirst({
      where: {
        followerId: userId,
        followingId: targetUserId
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

    console.log(`✅ User ${userId} unfollowed ${targetUserId}`);

    res.json({
      success: true,
      data: {
        message: 'Successfully unfollowed user'
      }
    });

  } catch (error) {
    console.error('💥 Error unfollowing user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unfollow user',
      details: error.message
    });
  }
});

// GET /api/social/friends/search - Search for users
router.get('/search', async (req, res) => {
  console.log('🔍 GET /friends/search called');
  
  try {
    const { q } = req.query;
    const userId = req.user.id;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters'
      });
    }

    // Search users by name or email
    const users = await prisma.user.findMany({
      where: {
        id: {
          not: userId // Exclude current user
        },
        OR: [
          {
            firstName: {
              contains: q,
              mode: 'insensitive'
            }
          },
          {
            lastName: {
              contains: q,
              mode: 'insensitive'
            }
          },
          {
            email: {
              contains: q,
              mode: 'insensitive'
            }
          }
        ]
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        profileImage: true,
        isOnline: true
      },
      take: 20
    });

    // Check follow status for each user
    const userIds = users.map(u => u.id);
    const followStatuses = await prisma.follow.findMany({
      where: {
        followerId: userId,
        followingId: {
          in: userIds
        }
      },
      select: {
        followingId: true
      }
    });

    const followingIds = followStatuses.map(f => f.followingId);

    const searchResults = users.map(user => ({
      id: user.id,
      name: formatUserName(user),
      email: user.email,
      avatar: formatUserAvatar(user),
      isOnline: user.isOnline,
      isFollowing: followingIds.includes(user.id)
    }));

    console.log(`🔍 Found ${searchResults.length} users for query: ${q}`);

    res.json({
      success: true,
      data: {
        users: searchResults,
        query: q
      }
    });

  } catch (error) {
    console.error('💥 Error searching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search users',
      details: error.message
    });
  }
});

module.exports = router;