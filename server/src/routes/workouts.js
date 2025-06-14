const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Get all workouts for the authenticated user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit = 10, page = 1 } = req.query;
    const skip = (page - 1) * parseInt(limit);

    const workouts = await prisma.workout.findMany({
      where: {
        userId: req.user.id
      },
      include: {
        exercises: {
          include: {
            exercise: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      },
      take: parseInt(limit),
      skip: skip
    });

    const totalWorkouts = await prisma.workout.count({
      where: { userId: req.user.id }
    });

    res.json({
      workouts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalWorkouts,
        totalPages: Math.ceil(totalWorkouts / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching workouts:', error);
    res.status(500).json({ 
      message: 'Error fetching workouts',
      error: error.message 
    });
  }
});

// Get single workout by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const workout = await prisma.workout.findFirst({
      where: {
        id,
        userId: req.user.id // Ensure user owns this workout
      },
      include: {
        exercises: {
          include: {
            exercise: true
          }
        }
      }
    });

    if (!workout) {
      return res.status(404).json({ message: 'Workout not found' });
    }

    res.json({ workout });
  } catch (error) {
    console.error('Error fetching workout:', error);
    res.status(500).json({ 
      message: 'Error fetching workout',
      error: error.message 
    });
  }
});

// Create new workout
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, date, notes, exercises } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ message: 'Workout name is required' });
    }

    // Create workout with exercises in a transaction
    const workout = await prisma.$transaction(async (prisma) => {
      // Create the workout
      const newWorkout = await prisma.workout.create({
        data: {
          name,
          date: date ? new Date(date) : new Date(),
          notes,
          userId: req.user.id
        }
      });

      // Add exercises if provided
      if (exercises && exercises.length > 0) {
        const workoutExercises = await Promise.all(
          exercises.map(exercise => 
            prisma.workoutExercise.create({
              data: {
                workoutId: newWorkout.id,
                exerciseId: exercise.exerciseId,
                sets: exercise.sets || 1,
                reps: exercise.reps || [1],
                weight: exercise.weight || [0],
                restTime: exercise.restTime,
                notes: exercise.notes
              }
            })
          )
        );
      }

      // Return workout with exercises
      return await prisma.workout.findUnique({
        where: { id: newWorkout.id },
        include: {
          exercises: {
            include: {
              exercise: true
            }
          }
        }
      });
    });

    res.status(201).json({
      message: 'Workout created successfully',
      workout
    });
  } catch (error) {
    console.error('Error creating workout:', error);
    res.status(500).json({ 
      message: 'Error creating workout',
      error: error.message 
    });
  }
});

// Add exercise to existing workout
router.post('/:id/exercises', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { exerciseId, sets, reps, weight, restTime, notes } = req.body;

    // Verify workout belongs to user
    const workout = await prisma.workout.findFirst({
      where: {
        id,
        userId: req.user.id
      }
    });

    if (!workout) {
      return res.status(404).json({ message: 'Workout not found' });
    }

    // Verify exercise exists
    const exercise = await prisma.exercise.findUnique({
      where: { id: exerciseId }
    });

    if (!exercise) {
      return res.status(404).json({ message: 'Exercise not found' });
    }

    const workoutExercise = await prisma.workoutExercise.create({
      data: {
        workoutId: id,
        exerciseId,
        sets: sets || 1,
        reps: reps || [1],
        weight: weight || [0],
        restTime,
        notes
      },
      include: {
        exercise: true
      }
    });

    res.status(201).json({
      message: 'Exercise added to workout',
      workoutExercise
    });
  } catch (error) {
    console.error('Error adding exercise to workout:', error);
    res.status(500).json({ 
      message: 'Error adding exercise to workout',
      error: error.message 
    });
  }
});

// Update workout exercise (for logging sets during workout)
router.put('/:workoutId/exercises/:exerciseId', authenticateToken, async (req, res) => {
  try {
    const { workoutId, exerciseId } = req.params;
    const { sets, reps, weight, restTime, notes } = req.body;

    // Verify workout belongs to user
    const workout = await prisma.workout.findFirst({
      where: {
        id: workoutId,
        userId: req.user.id
      }
    });

    if (!workout) {
      return res.status(404).json({ message: 'Workout not found' });
    }

    const workoutExercise = await prisma.workoutExercise.updateMany({
      where: {
        workoutId,
        exerciseId
      },
      data: {
        sets,
        reps,
        weight,
        restTime,
        notes
      }
    });

    if (workoutExercise.count === 0) {
      return res.status(404).json({ message: 'Exercise not found in workout' });
    }

    // Return updated exercise
    const updated = await prisma.workoutExercise.findFirst({
      where: {
        workoutId,
        exerciseId
      },
      include: {
        exercise: true
      }
    });

    res.json({
      message: 'Exercise updated successfully',
      workoutExercise: updated
    });
  } catch (error) {
    console.error('Error updating workout exercise:', error);
    res.status(500).json({ 
      message: 'Error updating workout exercise',
      error: error.message 
    });
  }
});

// Complete workout (calculate duration, mark as finished)
router.put('/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { duration, notes } = req.body;

    const workout = await prisma.workout.updateMany({
      where: {
        id,
        userId: req.user.id
      },
      data: {
        duration: duration || null,
        notes: notes || null
      }
    });

    if (workout.count === 0) {
      return res.status(404).json({ message: 'Workout not found' });
    }

    // Return completed workout
    const completedWorkout = await prisma.workout.findUnique({
      where: { id },
      include: {
        exercises: {
          include: {
            exercise: true
          }
        }
      }
    });

    res.json({
      message: 'Workout completed successfully',
      workout: completedWorkout
    });
  } catch (error) {
    console.error('Error completing workout:', error);
    res.status(500).json({ 
      message: 'Error completing workout',
      error: error.message 
    });
  }
});

// Delete workout
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const workout = await prisma.workout.deleteMany({
      where: {
        id,
        userId: req.user.id
      }
    });

    if (workout.count === 0) {
      return res.status(404).json({ message: 'Workout not found' });
    }

    res.json({ message: 'Workout deleted successfully' });
  } catch (error) {
    console.error('Error deleting workout:', error);
    res.status(500).json({ 
      message: 'Error deleting workout',
      error: error.message 
    });
  }
});

module.exports = router;