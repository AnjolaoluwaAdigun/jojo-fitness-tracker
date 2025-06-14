const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Get all workout templates with filters
router.get('/', async (req, res) => {
  try {
    const { category, difficulty, search, includePersonal } = req.query;
    const userId = req.headers.authorization ? req.user?.id : null;

    const where = {};
    
    // Public templates or user's personal templates
    if (includePersonal === 'true' && userId) {
      where.OR = [
        { isPublic: true },
        { createdById: userId }
      ];
    } else {
      where.isPublic = true;
    }
    
    if (category) {
      where.category = category;
    }
    
    if (difficulty) {
      where.difficulty = difficulty;
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const templates = await prisma.workoutTemplate.findMany({
      where,
      include: {
        exercises: {
          include: {
            exercise: true
          },
          orderBy: {
            order: 'asc'
          }
        },
        createdBy: {
          select: {
            username: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({
      templates,
      count: templates.length
    });
  } catch (error) {
    console.error('Error fetching workout templates:', error);
    res.status(500).json({ 
      message: 'Error fetching workout templates',
      error: error.message 
    });
  }
});

// Get single workout template by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const template = await prisma.workoutTemplate.findUnique({
      where: { id },
      include: {
        exercises: {
          include: {
            exercise: true
          },
          orderBy: {
            order: 'asc'
          }
        },
        createdBy: {
          select: {
            username: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    if (!template) {
      return res.status(404).json({ message: 'Workout template not found' });
    }

    res.json({ template });
  } catch (error) {
    console.error('Error fetching workout template:', error);
    res.status(500).json({ 
      message: 'Error fetching workout template',
      error: error.message 
    });
  }
});

// Create workout template (authenticated)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, category, difficulty, duration, exercises, isPublic = false } = req.body;

    if (!name || !category || !exercises || exercises.length === 0) {
      return res.status(400).json({ 
        message: 'Name, category, and exercises are required' 
      });
    }

    const template = await prisma.$transaction(async (prisma) => {
      // Create the template
      const newTemplate = await prisma.workoutTemplate.create({
        data: {
          name,
          description,
          category,
          difficulty: difficulty || 'Intermediate',
          duration,
          isPublic,
          createdById: req.user.id
        }
      });

      // Add exercises to template
      const templateExercises = await Promise.all(
        exercises.map((exercise, index) =>
          prisma.templateExercise.create({
            data: {
              templateId: newTemplate.id,
              exerciseId: exercise.exerciseId,
              order: index + 1,
              sets: exercise.sets || 3,
              reps: exercise.reps || [8, 8, 8],
              weight: exercise.weight || null,
              restTime: exercise.restTime || 90,
              notes: exercise.notes
            }
          })
        )
      );

      // Return template with exercises
      return await prisma.workoutTemplate.findUnique({
        where: { id: newTemplate.id },
        include: {
          exercises: {
            include: {
              exercise: true
            },
            orderBy: {
              order: 'asc'
            }
          }
        }
      });
    });

    res.status(201).json({
      message: 'Workout template created successfully',
      template
    });
  } catch (error) {
    console.error('Error creating workout template:', error);
    res.status(500).json({ 
      message: 'Error creating workout template',
      error: error.message 
    });
  }
});

// Create workout from template
router.post('/:id/create-workout', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date, notes } = req.body;

    // Get template with exercises
    const template = await prisma.workoutTemplate.findUnique({
      where: { id },
      include: {
        exercises: {
          include: {
            exercise: true
          },
          orderBy: {
            order: 'asc'
          }
        }
      }
    });

    if (!template) {
      return res.status(404).json({ message: 'Workout template not found' });
    }

    const workout = await prisma.$transaction(async (prisma) => {
      // Create workout
      const newWorkout = await prisma.workout.create({
        data: {
          name: name || template.name,
          date: date ? new Date(date) : new Date(),
          notes: notes || template.description,
          userId: req.user.id,
          templateId: template.id
        }
      });

      // Add exercises from template
      const workoutExercises = await Promise.all(
        template.exercises.map(templateExercise =>
          prisma.workoutExercise.create({
            data: {
              workoutId: newWorkout.id,
              exerciseId: templateExercise.exerciseId,
              sets: templateExercise.sets,
              reps: templateExercise.reps,
              weight: templateExercise.weight || [0],
              restTime: templateExercise.restTime,
              notes: templateExercise.notes
            }
          })
        )
      );

      // Return workout with exercises
      return await prisma.workout.findUnique({
        where: { id: newWorkout.id },
        include: {
          exercises: {
            include: {
              exercise: true
            }
          },
          template: true
        }
      });
    });

    res.status(201).json({
      message: 'Workout created from template successfully',
      workout
    });
  } catch (error) {
    console.error('Error creating workout from template:', error);
    res.status(500).json({ 
      message: 'Error creating workout from template',
      error: error.message 
    });
  }
});

// Update workout template (only by creator)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, difficulty, duration, isPublic } = req.body;

    const template = await prisma.workoutTemplate.findFirst({
      where: {
        id,
        createdById: req.user.id
      }
    });

    if (!template) {
      return res.status(404).json({ message: 'Workout template not found or not authorized' });
    }

    const updatedTemplate = await prisma.workoutTemplate.update({
      where: { id },
      data: {
        name: name || template.name,
        description: description !== undefined ? description : template.description,
        category: category || template.category,
        difficulty: difficulty || template.difficulty,
        duration: duration !== undefined ? duration : template.duration,
        isPublic: isPublic !== undefined ? isPublic : template.isPublic
      },
      include: {
        exercises: {
          include: {
            exercise: true
          },
          orderBy: {
            order: 'asc'
          }
        }
      }
    });

    res.json({
      message: 'Workout template updated successfully',
      template: updatedTemplate
    });
  } catch (error) {
    console.error('Error updating workout template:', error);
    res.status(500).json({ 
      message: 'Error updating workout template',
      error: error.message 
    });
  }
});

// Delete workout template (only by creator)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const template = await prisma.workoutTemplate.deleteMany({
      where: {
        id,
        createdById: req.user.id
      }
    });

    if (template.count === 0) {
      return res.status(404).json({ message: 'Workout template not found or not authorized' });
    }

    res.json({ message: 'Workout template deleted successfully' });
  } catch (error) {
    console.error('Error deleting workout template:', error);
    res.status(500).json({ 
      message: 'Error deleting workout template',
      error: error.message 
    });
  }
});

// Get template categories and difficulties
router.get('/meta/options', async (req, res) => {
  try {
    const categories = await prisma.workoutTemplate.findMany({
      select: { category: true },
      distinct: ['category'],
      where: { isPublic: true }
    });

    const difficulties = await prisma.workoutTemplate.findMany({
      select: { difficulty: true },
      distinct: ['difficulty'],
      where: { isPublic: true }
    });

    res.json({
      categories: categories.map(c => c.category),
      difficulties: difficulties.map(d => d.difficulty)
    });
  } catch (error) {
    console.error('Error fetching template options:', error);
    res.status(500).json({ 
      message: 'Error fetching template options',
      error: error.message 
    });
  }
});

module.exports = router;