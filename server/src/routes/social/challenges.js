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

// GET /api/social/challenges/trending - Get trending challenges
router.get('/trending', async (req, res) => {
  console.log('🎯 GET /challenges/trending called');
  
  try {
    const userId = req.user.id;

    // Get active challenges with participant counts
    const challenges = await prisma.challenge.findMany({
      where: {
        isActive: true,
        endDate: {
          gte: new Date() // Only active challenges
        }
      },
      include: {
        _count: {
          select: {
            participants: {
              where: {
                isActive: true
              }
            }
          }
        },
        participants: {
          where: {
            userId: userId,
            isActive: true
          },
          select: {
            id: true
          }
        }
      },
      orderBy: [
        {
          participants: {
            _count: 'desc'
          }
        },
        {
          createdAt: 'desc'
        }
      ],
      take: 10
    });

    const formattedChallenges = challenges.map(challenge => ({
      id: challenge.id,
      name: challenge.name,
      description: challenge.description,
      duration: challenge.duration,
      startDate: challenge.startDate.toISOString().split('T')[0], // YYYY-MM-DD format
      participants: challenge._count.participants,
      isJoined: challenge.participants.length > 0
    }));

    console.log(`🎯 Found ${formattedChallenges.length} trending challenges`);

    res.json({
      success: true,
      data: {
        challenges: formattedChallenges
      }
    });

  } catch (error) {
    console.error('💥 Error fetching trending challenges:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trending challenges',
      details: error.message
    });
  }
});

// POST /api/social/challenges/:id/join - Join a challenge
router.post('/:id/join', async (req, res) => {
  console.log(`🎯 POST /challenges/${req.params.id}/join called for user:`, req.user.id);
  
  try {
    const userId = req.user.id;
    const challengeId = req.params.id;

    // Check if challenge exists and is active
    const challenge = await prisma.challenge.findFirst({
      where: {
        id: challengeId,
        isActive: true,
        endDate: {
          gte: new Date()
        }
      }
    });

    if (!challenge) {
      return res.status(404).json({
        success: false,
        error: 'Challenge not found or has ended'
      });
    }

    // Check if user is already participating
    const existingParticipation = await prisma.challengeParticipant.findFirst({
      where: {
        userId,
        challengeId,
        isActive: true
      }
    });

    if (existingParticipation) {
      return res.status(400).json({
        success: false,
        error: 'You are already participating in this challenge'
      });
    }

    // Join the challenge
    await prisma.challengeParticipant.create({
      data: {
        userId,
        challengeId,
        isActive: true
      }
    });

    // Get updated participant count
    const participantCount = await prisma.challengeParticipant.count({
      where: {
        challengeId,
        isActive: true
      }
    });

    console.log(`✅ User ${userId} joined challenge ${challengeId}`);

    res.json({
      success: true,
      data: {
        message: 'Successfully joined challenge',
        participantCount
      }
    });

  } catch (error) {
    console.error('💥 Error joining challenge:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to join challenge',
      details: error.message
    });
  }
});

// POST /api/social/challenges - Create a new challenge
router.post('/', async (req, res) => {
  console.log('🎯 POST /challenges called');
  
  try {
    const userId = req.user.id;
    const { name, description, duration, startDate, category = 'general' } = req.body;

    if (!name || !duration || !startDate) {
      return res.status(400).json({
        success: false,
        error: 'Name, duration, and start date are required'
      });
    }

    // Calculate end date based on duration
    const start = new Date(startDate);
    const end = new Date(start);
    
    // Simple duration parsing (you can make this more sophisticated)
    const durationMatch = duration.match(/(\d+)\s*(day|week|month)s?/i);
    if (durationMatch) {
      const amount = parseInt(durationMatch[1]);
      const unit = durationMatch[2].toLowerCase();
      
      switch (unit) {
        case 'day':
          end.setDate(end.getDate() + amount);
          break;
        case 'week':
          end.setDate(end.getDate() + (amount * 7));
          break;
        case 'month':
          end.setMonth(end.getMonth() + amount);
          break;
      }
    } else {
      // Default to 30 days if we can't parse
      end.setDate(end.getDate() + 30);
    }

    const challenge = await prisma.challenge.create({
      data: {
        name,
        description: description || '',
        category,
        duration,
        startDate: start,
        endDate: end,
        creatorId: userId,
        isActive: true
      }
    });

    // Automatically join the creator to the challenge
    await prisma.challengeParticipant.create({
      data: {
        userId,
        challengeId: challenge.id,
        isActive: true
      }
    });

    console.log(`✅ Challenge created: ${challenge.id}`);

    res.status(201).json({
      success: true,
      data: {
        challenge: {
          id: challenge.id,
          name: challenge.name,
          description: challenge.description,
          duration: challenge.duration,
          startDate: challenge.startDate.toISOString().split('T')[0],
          participants: 1,
          isJoined: true
        }
      }
    });

  } catch (error) {
    console.error('💥 Error creating challenge:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create challenge',
      details: error.message
    });
  }
});

// GET /api/social/challenges - Get all challenges for a user
router.get('/', async (req, res) => {
  console.log('🎯 GET /challenges called for user:', req.user.id);
  
  try {
    const userId = req.user.id;

    const challenges = await prisma.challenge.findMany({
      where: {
        OR: [
          { creatorId: userId },
          {
            participants: {
              some: {
                userId: userId,
                isActive: true
              }
            }
          }
        ]
      },
      include: {
        _count: {
          select: {
            participants: {
              where: {
                isActive: true
              }
            }
          }
        },
        participants: {
          where: {
            userId: userId,
            isActive: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const formattedChallenges = challenges.map(challenge => ({
      id: challenge.id,
      name: challenge.name,
      description: challenge.description,
      duration: challenge.duration,
      startDate: challenge.startDate.toISOString().split('T')[0],
      endDate: challenge.endDate?.toISOString().split('T')[0],
      participants: challenge._count.participants,
      isJoined: challenge.participants.length > 0,
      isCreator: challenge.creatorId === userId,
      isActive: challenge.isActive && new Date() < challenge.endDate
    }));

    res.json({
      success: true,
      data: {
        challenges: formattedChallenges
      }
    });

  } catch (error) {
    console.error('💥 Error fetching challenges:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch challenges',
      details: error.message
    });
  }
});

module.exports = router;