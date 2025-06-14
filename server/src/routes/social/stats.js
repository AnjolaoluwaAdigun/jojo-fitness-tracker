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

// GET /api/social/stats/weekly - Get user's weekly stats
router.get('/weekly', async (req, res) => {
  console.log('📊 GET /stats/weekly called for user:', req.user.id);
  
  try {
    const userId = req.user.id;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Get weekly activities
    const weeklyActivities = await prisma.userActivity.findMany({
      where: {
        userId,
        createdAt: {
          gte: oneWeekAgo
        }
      }
    });

    // Get weekly posts count
    const weeklyPosts = await prisma.post.count({
      where: {
        userId,
        createdAt: {
          gte: oneWeekAgo
        }
      }
    });

    // Get weekly workouts count (from actual workouts table)
    const weeklyWorkouts = await prisma.workout.count({
      where: {
        userId,
        date: {
          gte: oneWeekAgo
        }
      }
    });

    // Calculate total calories from workout activities
    const totalCalories = weeklyActivities
      .filter(a => a.activityType === 'workout' && a.calories)
      .reduce((sum, a) => sum + (a.calories || 0), 0);

    // Calculate current streak from workouts table
    const allWorkouts = await prisma.workout.findMany({
      where: {
        userId
      },
      select: {
        date: true
      },
      orderBy: {
        date: 'desc'
      }
    });

    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    // Calculate consecutive days with workouts
    for (let i = 0; i < 365; i++) { // Check up to a year
      const dayStart = new Date(currentDate);
      const dayEnd = new Date(currentDate);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const hasWorkout = allWorkouts.some(workout => {
        const workoutDate = new Date(workout.date);
        workoutDate.setHours(0, 0, 0, 0);
        return workoutDate.getTime() === dayStart.getTime();
      });

      if (hasWorkout) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        break;
      }
    }

    const stats = {
      workouts: weeklyWorkouts,
      calories: totalCalories,
      posts: weeklyPosts,
      streak
    };

    console.log('📈 Weekly stats calculated:', stats);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('💥 Error fetching weekly stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch weekly stats',
      details: error.message
    });
  }
});

// GET /api/social/friends/online - Get online friends
router.get('/friends/online', async (req, res) => {
  console.log('👥 GET /friends/online called for user:', req.user.id);
  
  try {
    const userId = req.user.id;
    const fiveMinutesAgo = new Date();
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

    // Get friends who have been active in the last 5 minutes
    // Using your existing Follow model
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
        }
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
      take: 10
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

// GET /api/social/stats/leaderboard/weekly - Get weekly leaderboard (legacy endpoint)
router.get('/leaderboard/weekly', async (req, res) => {
  console.log('🏆 GET /stats/leaderboard/weekly called (redirecting to /leaderboard/weekly)');
  
  try {
    // Redirect to the new leaderboard endpoint
    const leaderboardRouter = require('./leaderboard');
    req.url = '/weekly';
    leaderboardRouter(req, res);
    
  } catch (error) {
    console.error('💥 Error in legacy leaderboard endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch weekly leaderboard',
      details: error.message
    });
  }
});
router.get('/leaderboard/weekly', async (req, res) => {
  console.log('🏆 GET /leaderboard/weekly called');
  
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Get workout counts for all users this week
    const weeklyWorkouts = await prisma.workout.groupBy({
      by: ['userId'],
      where: {
        date: {
          gte: oneWeekAgo
        }
      },
      _count: {
        id: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 10
    });

    // Get user details for the leaderboard
    const userIds = weeklyWorkouts.map(w => w.userId);
    const users = await prisma.user.findMany({
      where: {
        id: {
          in: userIds
        }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true
      }
    });

    // Create leaderboard with user details
    const leaderboard = weeklyWorkouts.map((workout, index) => {
      const user = users.find(u => u.id === workout.userId);
      return {
        id: workout.userId,
        name: user ? formatUserName(user) : 'Unknown User',
        workouts: workout._count.id,
        rank: index + 1,
        isCurrentUser: workout.userId === req.user.id
      };
    });

    console.log(`🏆 Generated leaderboard with ${leaderboard.length} entries`);

    res.json({
      success: true,
      data: {
        leaderboard
      }
    });

  } catch (error) {
    console.error('💥 Error fetching weekly leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch weekly leaderboard',
      details: error.message
    });
  }
});

module.exports = router;