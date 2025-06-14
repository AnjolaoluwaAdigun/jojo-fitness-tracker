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

// GET /api/social/leaderboard/weekly - Get weekly leaderboard
router.get('/weekly', async (req, res) => {
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
      _sum: {
        duration: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 50
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
        email: true,
        profileImage: true,
        isOnline: true
      }
    });

    // Get additional stats for each user
    const leaderboardWithStats = await Promise.all(
      weeklyWorkouts.map(async (workout, index) => {
        const user = users.find(u => u.id === workout.userId);
        
        if (!user) return null;

        // Get weekly calories burned
        const weeklyActivities = await prisma.userActivity.findMany({
          where: {
            userId: workout.userId,
            activityType: 'workout',
            createdAt: {
              gte: oneWeekAgo
            }
          },
          select: {
            calories: true
          }
        });

        const totalCalories = weeklyActivities.reduce((sum, activity) => {
          return sum + (activity.calories || 0);
        }, 0);

        // Get current workout streak
        const allWorkouts = await prisma.workout.findMany({
          where: {
            userId: workout.userId
          },
          select: {
            date: true
          },
          orderBy: {
            date: 'desc'
          }
        });

        // Calculate streak
        let streak = 0;
        let currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);

        for (let i = 0; i < 365; i++) { // Check up to a year
          const dayStart = new Date(currentDate);
          const dayEnd = new Date(currentDate);
          dayEnd.setDate(dayEnd.getDate() + 1);

          const hasWorkout = allWorkouts.some(w => {
            const workoutDate = new Date(w.date);
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

        return {
          id: workout.userId,
          name: formatUserName(user),
          avatar: formatUserAvatar(user),
          workouts: workout._count.id,
          totalDuration: workout._sum.duration || 0,
          totalCalories,
          streak,
          rank: index + 1,
          isCurrentUser: workout.userId === req.user.id,
          isOnline: user.isOnline
        };
      })
    );

    // Filter out null entries and sort by rank
    const leaderboard = leaderboardWithStats
      .filter(entry => entry !== null)
      .sort((a, b) => a.rank - b.rank);

    console.log(`🏆 Generated weekly leaderboard with ${leaderboard.length} entries`);

    res.json({
      success: true,
      data: {
        leaderboard,
        period: 'weekly',
        totalUsers: leaderboard.length
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

// GET /api/social/leaderboard/monthly - Get monthly leaderboard
router.get('/monthly', async (req, res) => {
  console.log('🏆 GET /leaderboard/monthly called');
  
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    // Get workout counts for all users this month
    const monthlyWorkouts = await prisma.workout.groupBy({
      by: ['userId'],
      where: {
        date: {
          gte: oneMonthAgo
        }
      },
      _count: {
        id: true
      },
      _sum: {
        duration: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 50
    });

    // Get user details for the leaderboard
    const userIds = monthlyWorkouts.map(w => w.userId);
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
        email: true,
        profileImage: true,
        isOnline: true
      }
    });

    // Create leaderboard with user details
    const leaderboard = monthlyWorkouts.map((workout, index) => {
      const user = users.find(u => u.id === workout.userId);
      return {
        id: workout.userId,
        name: user ? formatUserName(user) : 'Unknown User',
        avatar: user ? formatUserAvatar(user) : '',
        workouts: workout._count.id,
        totalDuration: workout._sum.duration || 0,
        rank: index + 1,
        isCurrentUser: workout.userId === req.user.id,
        isOnline: user?.isOnline || false
      };
    });

    console.log(`🏆 Generated monthly leaderboard with ${leaderboard.length} entries`);

    res.json({
      success: true,
      data: {
        leaderboard,
        period: 'monthly',
        totalUsers: leaderboard.length
      }
    });

  } catch (error) {
    console.error('💥 Error fetching monthly leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch monthly leaderboard',
      details: error.message
    });
  }
});

// GET /api/social/leaderboard/alltime - Get all-time leaderboard
router.get('/alltime', async (req, res) => {
  console.log('🏆 GET /leaderboard/alltime called');
  
  try {
    // Get workout counts for all users (all time)
    const allTimeWorkouts = await prisma.workout.groupBy({
      by: ['userId'],
      _count: {
        id: true
      },
      _sum: {
        duration: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 100
    });

    // Get user details for the leaderboard
    const userIds = allTimeWorkouts.map(w => w.userId);
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
        email: true,
        profileImage: true,
        isOnline: true,
        createdAt: true
      }
    });

    // Create leaderboard with user details
    const leaderboard = allTimeWorkouts.map((workout, index) => {
      const user = users.find(u => u.id === workout.userId);
      return {
        id: workout.userId,
        name: user ? formatUserName(user) : 'Unknown User',
        avatar: user ? formatUserAvatar(user) : '',
        workouts: workout._count.id,
        totalDuration: workout._sum.duration || 0,
        memberSince: user?.createdAt,
        rank: index + 1,
        isCurrentUser: workout.userId === req.user.id,
        isOnline: user?.isOnline || false
      };
    });

    console.log(`🏆 Generated all-time leaderboard with ${leaderboard.length} entries`);

    res.json({
      success: true,
      data: {
        leaderboard,
        period: 'alltime',
        totalUsers: leaderboard.length
      }
    });

  } catch (error) {
    console.error('💥 Error fetching all-time leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch all-time leaderboard',
      details: error.message
    });
  }
});

// GET /api/social/leaderboard/friends - Get friends-only leaderboard
router.get('/friends', async (req, res) => {
  console.log('🏆 GET /leaderboard/friends called for user:', req.user.id);
  
  try {
    const userId = req.user.id;
    const { period = 'weekly' } = req.query;

    // Get user's friends
    const friendships = await prisma.follow.findMany({
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
      ...friendships.map(f => f.followerId),
      ...friendships.map(f => f.followingId),
      userId // Include current user
    ].filter((id, index, self) => self.indexOf(id) === index); // Remove duplicates

    // Set date range based on period
    let dateFilter = {};
    if (period === 'weekly') {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      dateFilter = { gte: oneWeekAgo };
    } else if (period === 'monthly') {
      const oneMonthAgo = new Date();
      oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
      dateFilter = { gte: oneMonthAgo };
    }

    // Get workout counts for friends only
    const friendWorkouts = await prisma.workout.groupBy({
      by: ['userId'],
      where: {
        userId: {
          in: friendIds
        },
        ...(Object.keys(dateFilter).length > 0 && {
          date: dateFilter
        })
      },
      _count: {
        id: true
      },
      _sum: {
        duration: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      }
    });

    // Get user details for the leaderboard
    const users = await prisma.user.findMany({
      where: {
        id: {
          in: friendIds
        }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        profileImage: true,
        isOnline: true
      }
    });

    // Create leaderboard with user details
    const leaderboard = friendWorkouts.map((workout, index) => {
      const user = users.find(u => u.id === workout.userId);
      return {
        id: workout.userId,
        name: user ? formatUserName(user) : 'Unknown User',
        avatar: user ? formatUserAvatar(user) : '',
        workouts: workout._count.id,
        totalDuration: workout._sum.duration || 0,
        rank: index + 1,
        isCurrentUser: workout.userId === userId,
        isOnline: user?.isOnline || false,
        isFriend: workout.userId !== userId
      };
    });

    console.log(`🏆 Generated friends leaderboard with ${leaderboard.length} entries for period: ${period}`);

    res.json({
      success: true,
      data: {
        leaderboard,
        period,
        totalFriends: leaderboard.length - 1, // Exclude current user from count
        includesCurrentUser: leaderboard.some(entry => entry.isCurrentUser)
      }
    });

  } catch (error) {
    console.error('💥 Error fetching friends leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch friends leaderboard',
      details: error.message
    });
  }
});

// GET /api/social/leaderboard/stats - Get leaderboard statistics
router.get('/stats', async (req, res) => {
  console.log('📊 GET /leaderboard/stats called');
  
  try {
    const userId = req.user.id;

    // Get various time periods
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    // Get user's ranks for different periods - FIXED: Each await gets its own const
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
      }
    });

    const monthlyWorkouts = await prisma.workout.groupBy({
      by: ['userId'],
      where: {
        date: {
          gte: oneMonthAgo
        }
      },
      _count: {
        id: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      }
    });

    const allTimeWorkouts = await prisma.workout.groupBy({
      by: ['userId'],
      _count: {
        id: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      }
    });

    // Find user's position in each leaderboard
    const weeklyRank = weeklyWorkouts.findIndex(w => w.userId === userId) + 1;
    const monthlyRank = monthlyWorkouts.findIndex(w => w.userId === userId) + 1;
    const allTimeRank = allTimeWorkouts.findIndex(w => w.userId === userId) + 1;

    // Get user's workout counts
    const userWeeklyWorkouts = weeklyWorkouts.find(w => w.userId === userId)?._count.id || 0;
    const userMonthlyWorkouts = monthlyWorkouts.find(w => w.userId === userId)?._count.id || 0;
    const userAllTimeWorkouts = allTimeWorkouts.find(w => w.userId === userId)?._count.id || 0;

    // Get total number of active users for each period
    const totalWeeklyUsers = weeklyWorkouts.length;
    const totalMonthlyUsers = monthlyWorkouts.length;
    const totalAllTimeUsers = allTimeWorkouts.length;

    // Calculate percentiles
    const weeklyPercentile = weeklyRank > 0 ? Math.round(((totalWeeklyUsers - weeklyRank + 1) / totalWeeklyUsers) * 100) : 0;
    const monthlyPercentile = monthlyRank > 0 ? Math.round(((totalMonthlyUsers - monthlyRank + 1) / totalMonthlyUsers) * 100) : 0;
    const allTimePercentile = allTimeRank > 0 ? Math.round(((totalAllTimeUsers - allTimeRank + 1) / totalAllTimeUsers) * 100) : 0;

    // Get user's personal bests
    const personalBests = {
      maxWorkoutsInWeek: 0,
      maxWorkoutsInMonth: 0,
      longestStreak: 0,
      totalWorkouts: userAllTimeWorkouts
    };

    // Calculate max workouts in a week (check last 12 weeks)
    for (let i = 0; i < 12; i++) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i * 7 + 7));
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - (i * 7));

      const weeklyCount = await prisma.workout.count({
        where: {
          userId,
          date: {
            gte: weekStart,
            lt: weekEnd
          }
        }
      });

      personalBests.maxWorkoutsInWeek = Math.max(personalBests.maxWorkoutsInWeek, weeklyCount);
    }

    // Calculate max workouts in a month (check last 6 months)
    for (let i = 0; i < 6; i++) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - (i + 1));
      monthStart.setDate(1);
      const monthEnd = new Date();
      monthEnd.setMonth(monthEnd.getMonth() - i);
      monthEnd.setDate(0);

      const monthlyCount = await prisma.workout.count({
        where: {
          userId,
          date: {
            gte: monthStart,
            lt: monthEnd
          }
        }
      });

      personalBests.maxWorkoutsInMonth = Math.max(personalBests.maxWorkoutsInMonth, monthlyCount);
    }

    // Calculate longest streak
    const allUserWorkouts = await prisma.workout.findMany({
      where: { userId },
      select: { date: true },
      orderBy: { date: 'desc' }
    });

    let maxStreak = 0;
    let currentStreak = 0;
    let lastDate = null;

    for (const workout of allUserWorkouts) {
      const workoutDate = new Date(workout.date);
      workoutDate.setHours(0, 0, 0, 0);

      if (lastDate === null) {
        currentStreak = 1;
      } else {
        const daysDiff = Math.floor((lastDate.getTime() - workoutDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff === 1) {
          currentStreak++;
        } else {
          maxStreak = Math.max(maxStreak, currentStreak);
          currentStreak = 1;
        }
      }
      
      lastDate = workoutDate;
    }
    maxStreak = Math.max(maxStreak, currentStreak);
    personalBests.longestStreak = maxStreak;

    const stats = {
      rankings: {
        weekly: {
          rank: weeklyRank || null,
          totalUsers: totalWeeklyUsers,
          workouts: userWeeklyWorkouts,
          percentile: weeklyPercentile
        },
        monthly: {
          rank: monthlyRank || null,
          totalUsers: totalMonthlyUsers,
          workouts: userMonthlyWorkouts,
          percentile: monthlyPercentile
        },
        allTime: {
          rank: allTimeRank || null,
          totalUsers: totalAllTimeUsers,
          workouts: userAllTimeWorkouts,
          percentile: allTimePercentile
        }
      },
      personalBests
    };

    console.log(`📊 Generated leaderboard stats for user ${userId}`);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('💥 Error fetching leaderboard stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch leaderboard stats',
      details: error.message
    });
  }
});

module.exports = router;