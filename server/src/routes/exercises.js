const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Get all exercises with optional filtering
router.get('/', async (req, res) => {
  try {
    const { category, muscleGroup, search } = req.query;

    // Get all exercises first
    let exercises = await prisma.exercise.findMany({
      orderBy: {
        name: 'asc'
      }
    });

    // Apply filters in JavaScript (more reliable for SQLite)
    if (category) {
      exercises = exercises.filter(exercise => 
        exercise.category.toLowerCase() === category.toLowerCase()
      );
    }

    if (search) {
      exercises = exercises.filter(exercise => 
        exercise.name.toLowerCase().includes(search.toLowerCase())
      );
    }

    if (muscleGroup) {
      exercises = exercises.filter(exercise => {
        return Array.isArray(exercise.muscleGroups) && 
               exercise.muscleGroups.some(group => 
                 group.toLowerCase().includes(muscleGroup.toLowerCase())
               );
      });
    }

    res.json({
      exercises,
      count: exercises.length,
      filters: { category, muscleGroup, search }
    });
  } catch (error) {
    console.error('Error fetching exercises:', error);
    res.status(500).json({ 
      message: 'Error fetching exercises',
      error: error.message 
    });
  }
});

// Get single exercise by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const exercise = await prisma.exercise.findUnique({
      where: { id }
    });

    if (!exercise) {
      return res.status(404).json({ message: 'Exercise not found' });
    }

    res.json({ exercise });
  } catch (error) {
    console.error('Error fetching exercise:', error);
    res.status(500).json({ 
      message: 'Error fetching exercise',
      error: error.message 
    });
  }
});

module.exports = router;