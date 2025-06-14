const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Get user's overall progress summary
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query; // Default to last 30 days
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get workout count and streak
    const totalWorkouts = await prisma.workout.count({
      where: { userId }
    });

    const recentWorkouts = await prisma.workout.count({
      where: {
        userId,
        date: { gte: startDate }
      }
    });

    // Calculate current streak
    const workoutsForStreak = await prisma.workout.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 100, // Look at last 100 workouts for streak calculation
      select: { date: true }
    });

    let currentStreak = 0;
    let lastWorkoutDate = null;

    for (const workout of workoutsForStreak) {
      const workoutDate = new Date(workout.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      workoutDate.setHours(0, 0, 0, 0);

      if (!lastWorkoutDate) {
        // First workout in the list
        const daysDiff = Math.floor((today - workoutDate) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 1) { // Today or yesterday
          currentStreak = 1;
          lastWorkoutDate = workoutDate;
        } else {
          break; // No recent workout, streak is 0
        }
      } else {
        // Check if this workout is consecutive
        const daysDiff = Math.floor((lastWorkoutDate - workoutDate) / (1000 * 60 * 60 * 24));
        if (daysDiff === 1) {
          currentStreak++;
          lastWorkoutDate = workoutDate;
        } else if (daysDiff === 0) {
          // Same day, continue
          lastWorkoutDate = workoutDate;
        } else {
          break; // Gap in streak
        }
      }
    }

    // Get favorite exercises (most frequently used)
    const exerciseUsage = await prisma.workoutExercise.groupBy({
      by: ['exerciseId'],
      where: {
        workout: { userId }
      },
      _count: {
        exerciseId: true
      },
      orderBy: {
        _count: {
          exerciseId: 'desc'
        }
      },
      take: 5
    });

    const favoriteExercises = await Promise.all(
      exerciseUsage.map(async (usage) => {
        const exercise = await prisma.exercise.findUnique({
          where: { id: usage.exerciseId }
        });
        return {
          exercise,
          timesUsed: usage._count.exerciseId
        };
      })
    );

    // Get total time spent working out
    const totalDuration = await prisma.workout.aggregate({
      where: {
        userId,
        duration: { not: null }
      },
      _sum: {
        duration: true
      }
    });

    res.json({
      summary: {
        totalWorkouts,
        recentWorkouts,
        currentStreak,
        totalTimeMinutes: totalDuration._sum.duration || 0,
        favoriteExercises,
        period: `Last ${days} days`
      }
    });
  } catch (error) {
    console.error('Error fetching progress summary:', error);
    res.status(500).json({ 
      message: 'Error fetching progress summary',
      error: error.message 
    });
  }
});

// Get exercise-specific progress (strength progression)
router.get('/exercise/:exerciseId', authenticateToken, async (req, res) => {
  try {
    const { exerciseId } = req.params;
    const userId = req.user.id;
    const { limit = 20 } = req.query;

    // Get exercise details
    const exercise = await prisma.exercise.findUnique({
      where: { id: exerciseId }
    });

    if (!exercise) {
      return res.status(404).json({ message: 'Exercise not found' });
    }

    // Get workout history for this exercise
    const exerciseHistory = await prisma.workoutExercise.findMany({
      where: {
        exerciseId,
        workout: { userId }
      },
      include: {
        workout: {
          select: {
            id: true,
            name: true,
            date: true
          }
        }
      },
      orderBy: {
        workout: {
          date: 'desc'
        }
      },
      take: parseInt(limit)
    });

    // Calculate progression metrics
    const progressData = exerciseHistory.map(entry => {
      const maxWeight = Array.isArray(entry.weight) 
        ? Math.max(...entry.weight.filter(w => w > 0))
        : 0;
      const totalVolume = Array.isArray(entry.weight) && Array.isArray(entry.reps)
        ? entry.weight.reduce((sum, weight, index) => 
            sum + (weight * (entry.reps[index] || 0)), 0)
        : 0;
      const maxReps = Array.isArray(entry.reps)
        ? Math.max(...entry.reps)
        : 0;

      return {
        date: entry.workout.date,
        workoutName: entry.workout.name,
        sets: entry.sets,
        reps: entry.reps,
        weight: entry.weight,
        maxWeight,
        maxReps,
        totalVolume
      };
    });

    // Calculate personal records
    const allTimeMaxWeight = Math.max(...progressData.map(p => p.maxWeight));
    const allTimeMaxVolume = Math.max(...progressData.map(p => p.totalVolume));
    const allTimeMaxReps = Math.max(...progressData.map(p => p.maxReps));

    res.json({
      exercise,
      progressData: progressData.reverse(), // Oldest first for chart display
      personalRecords: {
        maxWeight: allTimeMaxWeight,
        maxVolume: allTimeMaxVolume,
        maxReps: allTimeMaxReps
      },
      totalSessions: progressData.length
    });
  } catch (error) {
    console.error('Error fetching exercise progress:', error);
    res.status(500).json({ 
      message: 'Error fetching exercise progress',
      error: error.message 
    });
  }
});

// Get workout frequency analytics
router.get('/frequency', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 90 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const workouts = await prisma.workout.findMany({
      where: {
        userId,
        date: { gte: startDate }
      },
      select: {
        date: true,
        duration: true
      },
      orderBy: {
        date: 'asc'
      }
    });

    // Group by week
    const weeklyData = {};
    workouts.forEach(workout => {
      const date = new Date(workout.date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = {
          week: weekKey,
          workouts: 0,
          totalDuration: 0
        };
      }

      weeklyData[weekKey].workouts++;
      weeklyData[weekKey].totalDuration += workout.duration || 0;
    });

    // Group by day of week
    const dayOfWeekData = {};
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    dayNames.forEach(day => {
      dayOfWeekData[day] = 0;
    });

    workouts.forEach(workout => {
      const dayName = dayNames[new Date(workout.date).getDay()];
      dayOfWeekData[dayName]++;
    });

    res.json({
      weeklyFrequency: Object.values(weeklyData),
      dayOfWeekFrequency: dayOfWeekData,
      averageWorkoutsPerWeek: Object.values(weeklyData).length > 0 
        ? Object.values(weeklyData).reduce((sum, week) => sum + week.workouts, 0) / Object.values(weeklyData).length
        : 0,
      period: `Last ${days} days`
    });
  } catch (error) {
    console.error('Error fetching frequency analytics:', error);
    res.status(500).json({ 
      message: 'Error fetching frequency analytics',
      error: error.message 
    });
  }
});

// Get muscle group balance analytics
router.get('/muscle-groups', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get all workout exercises for the user in the time period
    const workoutExercises = await prisma.workoutExercise.findMany({
      where: {
        workout: {
          userId,
          date: { gte: startDate }
        }
      },
      include: {
        exercise: {
          select: {
            muscleGroups: true,
            name: true
          }
        }
      }
    });

    // Count muscle group usage
    const muscleGroupCount = {};
    const exerciseVolume = {};

    workoutExercises.forEach(we => {
      if (Array.isArray(we.exercise.muscleGroups)) {
        we.exercise.muscleGroups.forEach(muscleGroup => {
          if (!muscleGroupCount[muscleGroup]) {
            muscleGroupCount[muscleGroup] = 0;
            exerciseVolume[muscleGroup] = 0;
          }
          muscleGroupCount[muscleGroup]++;
          
          // Calculate volume for this muscle group
          const volume = Array.isArray(we.weight) && Array.isArray(we.reps)
            ? we.weight.reduce((sum, weight, index) => 
                sum + (weight * (we.reps[index] || 0)), 0)
            : 0;
          exerciseVolume[muscleGroup] += volume;
        });
      }
    });

    // Convert to array and sort
    const muscleGroupAnalytics = Object.keys(muscleGroupCount).map(muscleGroup => ({
      muscleGroup,
      exerciseCount: muscleGroupCount[muscleGroup],
      totalVolume: exerciseVolume[muscleGroup]
    })).sort((a, b) => b.exerciseCount - a.exerciseCount);

    res.json({
      muscleGroupBalance: muscleGroupAnalytics,
      period: `Last ${days} days`,
      totalExercises: workoutExercises.length
    });
  } catch (error) {
    console.error('Error fetching muscle group analytics:', error);
    res.status(500).json({ 
      message: 'Error fetching muscle group analytics',
      error: error.message 
    });
  }
});

// Get personal records across all exercises
router.get('/records', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all workout exercises for the user
    const workoutExercises = await prisma.workoutExercise.findMany({
      where: {
        workout: { userId }
      },
      include: {
        exercise: {
          select: {
            id: true,
            name: true
          }
        },
        workout: {
          select: {
            date: true
          }
        }
      }
    });

    // Calculate records for each exercise
    const exerciseRecords = {};

    workoutExercises.forEach(we => {
      const exerciseId = we.exercise.id;
      const exerciseName = we.exercise.name;

      if (!exerciseRecords[exerciseId]) {
        exerciseRecords[exerciseId] = {
          exerciseId,
          exerciseName,
          maxWeight: 0,
          maxVolume: 0,
          maxReps: 0,
          maxWeightDate: null,
          maxVolumeDate: null,
          maxRepsDate: null
        };
      }

      const maxWeight = Array.isArray(we.weight) 
        ? Math.max(...we.weight.filter(w => w > 0))
        : 0;
      const totalVolume = Array.isArray(we.weight) && Array.isArray(we.reps)
        ? we.weight.reduce((sum, weight, index) => 
            sum + (weight * (we.reps[index] || 0)), 0)
        : 0;
      const maxReps = Array.isArray(we.reps)
        ? Math.max(...we.reps)
        : 0;

      // Update records if this is a new PR
      if (maxWeight > exerciseRecords[exerciseId].maxWeight) {
        exerciseRecords[exerciseId].maxWeight = maxWeight;
        exerciseRecords[exerciseId].maxWeightDate = we.workout.date;
      }

      if (totalVolume > exerciseRecords[exerciseId].maxVolume) {
        exerciseRecords[exerciseId].maxVolume = totalVolume;
        exerciseRecords[exerciseId].maxVolumeDate = we.workout.date;
      }

      if (maxReps > exerciseRecords[exerciseId].maxReps) {
        exerciseRecords[exerciseId].maxReps = maxReps;
        exerciseRecords[exerciseId].maxRepsDate = we.workout.date;
      }
    });

    const personalRecords = Object.values(exerciseRecords)
      .filter(record => record.maxWeight > 0 || record.maxVolume > 0 || record.maxReps > 0)
      .sort((a, b) => b.maxWeight - a.maxWeight);

    res.json({
      personalRecords,
      totalExercises: personalRecords.length
    });
  } catch (error) {
    console.error('Error fetching personal records:', error);
    res.status(500).json({ 
      message: 'Error fetching personal records',
      error: error.message 
    });
  }
});

module.exports = router;