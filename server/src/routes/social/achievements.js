const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Achievement checking logic
const checkAndUnlockAchievements = async (userId) => {
  try {
    console.log(`🏆 Checking achievements for user: ${userId}`);

    // Get user's current achievements
    const userAchievements = await prisma.userAchievement.findMany({
      where: { userId },
      select: { achievementId: true }
    });
    
    const unlockedAchievementIds = userAchievements.map(ua => ua.achievementId);

    // Get all available achievements
    const allAchievements = await prisma.masterAchievement.findMany({
      where: { isActive: true }
    });

    const newAchievements = [];

    for (const achievement of allAchievements) {
      // Skip if already unlocked
      if (unlockedAchievementIds.includes(achievement.id)) continue;

      let shouldUnlock = false;

      // Check achievement requirements based on name/category
      switch (achievement.name) {
        case 'Early Bird':
          // Check if user has morning workouts (before 9 AM)
          const morningWorkouts = await prisma.userActivity.count({
            where: {
              userId,
              activityType: 'workout',
              createdAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
              }
            }
          });
          
          shouldUnlock = morningWorkouts >= 3;
          break;

        case 'Consistency King':
          // Check workout count in last 2 weeks
          const twoWeeksAgo = new Date();
          twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
          
          const recentWorkouts = await prisma.workout.count({
            where: {
              userId,
              date: {
                gte: twoWeeksAgo
              }
            }
          });
          
          shouldUnlock = recentWorkouts >= 7; // 7+ workouts in 2 weeks
          break;

        case 'PR Crusher':
          // Check if user has posted any achievements
          const achievementPosts = await prisma.post.count({
            where: {
              userId,
              type: 'achievement',
              achievementData: {
                not: null
              }
            }
          });
          
          shouldUnlock = achievementPosts >= 1;
          break;

        case 'Social Butterfly':
          // Check if user has posted and has followers
          const posts = await prisma.post.count({
            where: { userId }
          });
          
          const followers = await prisma.follow.count({
            where: {
              followingId: userId
            }
          });
          
          shouldUnlock = posts >= 5 && followers >= 2;
          break;

        case 'Challenger':
          // Check if user has joined or created challenges
          const challengeParticipations = await prisma.challengeParticipant.count({
            where: { userId, isActive: true }
          });
          
          shouldUnlock = challengeParticipations >= 1;
          break;

        case 'Marathon Warrior':
          // Check 30 workouts in last month
          const oneMonthAgo = new Date();
          oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
          
          const monthlyWorkouts = await prisma.workout.count({
            where: {
              userId,
              date: {
                gte: oneMonthAgo
              }
            }
          });
          
          shouldUnlock = monthlyWorkouts >= 30;
          break;

        case 'Strength Legend':
          // Check multiple achievement posts
          const multipleAchievements = await prisma.post.count({
            where: {
              userId,
              type: 'achievement',
              achievementData: {
                not: null
              }
            }
          });
          
          shouldUnlock = multipleAchievements >= 10;
          break;

        default:
          // Custom achievement logic can be added here
          break;
      }

      if (shouldUnlock) {
        // Unlock the achievement
        await prisma.userAchievement.create({
          data: {
            userId,
            achievementId: achievement.id
          }
        });
        
        newAchievements.push(achievement);
        console.log(`🎉 Unlocked achievement: ${achievement.name} for user: ${userId}`);
      }
    }

    return newAchievements;
  } catch (error) {
    console.error('💥 Error checking achievements:', error);
    return [];
  }
};

// GET /api/social/achievements/recent - Get user's recent achievements
router.get('/recent', async (req, res) => {
  console.log('🏆 GET /achievements/recent called for user:', req.user.id);
  
  try {
    const userId = req.user.id;

    // Get user's recent achievements (last 30 days)
    const recentAchievements = await prisma.userAchievement.findMany({
      where: {
        userId,
        unlockedAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      },
      include: {
        achievement: true
      },
      orderBy: {
        unlockedAt: 'desc'
      },
      take: 5
    });

    const formattedAchievements = recentAchievements.map(ua => ({
      id: ua.achievement.id,
      name: ua.achievement.name,
      description: ua.achievement.description,
      icon: ua.achievement.icon || '🏆',
      unlockedAt: formatTimeAgo(ua.unlockedAt),
      category: ua.achievement.category
    }));

    console.log(`🏆 Found ${formattedAchievements.length} recent achievements`);

    res.json({
      success: true,
      data: {
        achievements: formattedAchievements
      }
    });

  } catch (error) {
    console.error('💥 Error fetching recent achievements:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent achievements',
      details: error.message
    });
  }
});

// GET /api/social/achievements - Get all user achievements
router.get('/', async (req, res) => {
  console.log('🏆 GET /achievements called for user:', req.user.id);
  
  try {
    const userId = req.user.id;

    // Check for new achievements first
    await checkAndUnlockAchievements(userId);

    // Get all user achievements
    const userAchievements = await prisma.userAchievement.findMany({
      where: { userId },
      include: {
        achievement: true
      },
      orderBy: {
        unlockedAt: 'desc'
      }
    });

    // Get all available achievements for progress tracking
    const allAchievements = await prisma.masterAchievement.findMany({
      where: { isActive: true }
    });

    const unlockedIds = userAchievements.map(ua => ua.achievementId);
    
    const unlocked = userAchievements.map(ua => ({
      id: ua.achievement.id,
      name: ua.achievement.name,
      description: ua.achievement.description,
      icon: ua.achievement.icon || '🏆',
      unlockedAt: ua.unlockedAt,
      category: ua.achievement.category
    }));

    const locked = allAchievements
      .filter(a => !unlockedIds.includes(a.id))
      .map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        icon: '🔒',
        category: a.category,
        isLocked: true
      }));

    res.json({
      success: true,
      data: {
        unlocked,
        locked,
        total: allAchievements.length,
        unlockedCount: unlocked.length
      }
    });

  } catch (error) {
    console.error('💥 Error fetching achievements:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch achievements',
      details: error.message
    });
  }
});

// POST /api/social/achievements/check - Manually trigger achievement check
router.post('/check', async (req, res) => {
  console.log('🏆 POST /achievements/check called for user:', req.user.id);
  
  try {
    const userId = req.user.id;
    const newAchievements = await checkAndUnlockAchievements(userId);

    res.json({
      success: true,
      data: {
        newAchievements: newAchievements.map(a => ({
          id: a.id,
          name: a.name,
          description: a.description,
          icon: a.icon || '🏆'
        })),
        count: newAchievements.length
      }
    });

  } catch (error) {
    console.error('💥 Error checking achievements:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check achievements',
      details: error.message
    });
  }
});

// Helper function to format time ago
function formatTimeAgo(date) {
  const now = new Date();
  const diffInMs = now - date;
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  
  if (diffInDays === 0) {
    return 'Today';
  } else if (diffInDays === 1) {
    return 'Yesterday';
  } else if (diffInDays < 7) {
    return `${diffInDays} days ago`;
  } else if (diffInDays < 30) {
    const weeks = Math.floor(diffInDays / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  } else {
    return 'Recently unlocked';
  }
}

module.exports = router;