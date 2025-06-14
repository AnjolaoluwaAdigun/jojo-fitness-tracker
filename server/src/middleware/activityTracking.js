const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Activity tracking middleware
const trackActivity = (activityType, options = {}) => {
  return async (req, res, next) => {
    // Store original res.json to intercept successful responses
    const originalJson = res.json;
    
    res.json = function(data) {
      // Only track activity if the response was successful
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        trackUserActivity(req.user.id, activityType, {
          ...options,
          requestData: req.body,
          responseData: data
        }).catch(error => {
          console.error('Error tracking activity:', error);
        });
      }
      
      // Call original res.json
      return originalJson.call(this, data);
    };
    
    next();
  };
};

// Function to track user activity
const trackUserActivity = async (userId, activityType, data = {}) => {
  try {
    console.log(`📊 Tracking activity: ${activityType} for user: ${userId}`);

    let activityData = {
      userId,
      activityType,
      data: data.requestData || {}
    };

    // Extract specific data based on activity type
    switch (activityType) {
      case 'workout':
        if (data.requestData?.workoutData) {
          const workout = typeof data.requestData.workoutData === 'string' 
            ? JSON.parse(data.requestData.workoutData) 
            : data.requestData.workoutData;
          
          activityData.calories = workout.calories || null;
          activityData.duration = parseDuration(workout.duration);
          activityData.data = {
            workoutName: workout.name,
            difficulty: workout.difficulty,
            exercises: workout.exercises
          };
        }
        break;

      case 'post':
        activityData.data = {
          postType: data.requestData?.type || 'general',
          hasMedia: !!(data.requestData?.media && data.requestData.media.length > 0)
        };
        break;

      case 'achievement':
        if (data.requestData?.achievementData) {
          const achievement = typeof data.requestData.achievementData === 'string'
            ? JSON.parse(data.requestData.achievementData)
            : data.requestData.achievementData;
          
          activityData.data = {
            exercise: achievement.exercise,
            weight: achievement.weight,
            reps: achievement.reps
          };
        }
        break;

      case 'login':
        activityData.data = {
          userAgent: data.userAgent,
          ipAddress: data.ipAddress
        };
        break;

      default:
        // Keep the default data structure
        break;
    }

    // Create the activity record
    await prisma.userActivity.create({
      data: activityData
    });

    // Update user's last seen timestamp
    await prisma.user.update({
      where: { id: userId },
      data: { 
        lastSeen: new Date(),
        isOnline: true
      }
    });

    console.log(`✅ Activity tracked: ${activityType}`);

  } catch (error) {
    console.error('💥 Error tracking user activity:', error);
  }
};

// Helper function to parse duration strings into minutes
const parseDuration = (durationStr) => {
  if (!durationStr) return null;
  
  const match = durationStr.toString().match(/(\d+)/);
  if (match) {
    const number = parseInt(match[1]);
    
    // Assume minutes if no unit specified, or if "min" is in the string
    if (durationStr.includes('min') || durationStr.includes('minute')) {
      return number;
    }
    // If "hour" is specified, convert to minutes
    else if (durationStr.includes('hour') || durationStr.includes('hr')) {
      return number * 60;
    }
    // Default to minutes
    else {
      return number;
    }
  }
  
  return null;
};

// Middleware to update user online status
const updateOnlineStatus = async (req, res, next) => {
  if (req.user) {
    try {
      // Update user's last seen and online status
      await prisma.user.update({
        where: { id: req.user.id },
        data: { 
          lastSeen: new Date(),
          isOnline: true
        }
      });

      // Update or create user session
      const sessionToken = req.headers.authorization?.replace('Bearer ', '');
      if (sessionToken) {
        await prisma.userSession.upsert({
          where: { token: sessionToken },
          update: { 
            lastSeen: new Date(),
            isActive: true
          },
          create: {
            userId: req.user.id,
            token: sessionToken,
            lastSeen: new Date(),
            isActive: true,
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip || req.connection.remoteAddress
          }
        });
      }
    } catch (error) {
      console.error('Error updating online status:', error);
    }
  }
  next();
};

// Function to clean up offline users (run periodically)
const cleanupOfflineUsers = async () => {
  try {
    const fiveMinutesAgo = new Date();
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

    // Mark users as offline if they haven't been seen in 5 minutes
    await prisma.user.updateMany({
      where: {
        lastSeen: {
          lt: fiveMinutesAgo
        },
        isOnline: true
      },
      data: {
        isOnline: false
      }
    });

    // Deactivate old sessions
    await prisma.userSession.updateMany({
      where: {
        lastSeen: {
          lt: fiveMinutesAgo
        },
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    console.log('🧹 Cleaned up offline users and sessions');
  } catch (error) {
    console.error('Error cleaning up offline users:', error);
  }
};

// Export the middleware and utility functions
module.exports = {
  trackActivity,
  trackUserActivity,
  updateOnlineStatus,
  cleanupOfflineUsers
};