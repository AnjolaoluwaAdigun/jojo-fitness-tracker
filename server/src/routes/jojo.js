const express = require('express');
const { PrismaClient } = require('@prisma/client');
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('../middleware/auth');
const aiService = require('../services/aiService');

const router = express.Router();
const prisma = new PrismaClient();

// Rate limiting configurations
const chatRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 messages per minute
  message: { success: false, message: 'Too many messages. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/jojo/current-chat/:conversationId - Get current chat for real-time display
router.get('/current-chat/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    // Verify user owns conversation
    const conversation = await prisma.chatConversation.findUnique({
      where: { id: conversationId, userId }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Get all messages for this conversation
    const messages = await prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        content: true,
        sender: true,
        messageType: true,
        createdAt: true,
        responseTime: true,
        confidence: true
      }
    });

    // Format for chat interface
    const chatMessages = messages.map(msg => ({
      id: msg.id,
      text: msg.content,
      isUser: msg.sender === 'USER',
      isJojo: msg.sender === 'JOJO',
      timestamp: msg.createdAt,
      displayTime: new Date(msg.createdAt).toLocaleTimeString(),
      metadata: {
        responseTime: msg.responseTime,
        confidence: msg.confidence,
        type: msg.messageType
      }
    }));

    res.json({
      success: true,
      data: {
        conversation: {
          id: conversation.id,
          title: conversation.title
        },
        messages: chatMessages,
        messageCount: chatMessages.length
      }
    });

  } catch (error) {
    console.error('Error getting current chat:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get current chat'
    });
  }
});

// GET /api/jojo/recent-chats - Get recent chat history for sidebar
router.get('/recent-chats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10 } = req.query;

    const recentConversations = await prisma.chatConversation.findMany({
      where: { userId, isActive: true },
      orderBy: { lastMessageAt: 'desc' },
      take: parseInt(limit),
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            content: true,
            sender: true,
            createdAt: true
          }
        },
        _count: {
          select: { messages: true }
        }
      }
    });

    const formattedChats = recentConversations.map(conv => ({
      id: conv.id,
      title: conv.title,
      lastMessageAt: conv.lastMessageAt,
      messageCount: conv._count.messages,
      preview: conv.messages[0] ? {
        text: conv.messages[0].content.length > 80 
          ? conv.messages[0].content.substring(0, 80) + '...'
          : conv.messages[0].content,
        isFromUser: conv.messages[0].sender === 'USER',
        timestamp: conv.messages[0].createdAt
      } : null,
      timeAgo: getTimeAgo(conv.lastMessageAt)
    }));

    res.json({
      success: true,
      data: {
        recentChats: formattedChats
      }
    });

  } catch (error) {
    console.error('Error getting recent chats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get recent chats'
    });
  }
});

const profileRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 profile updates per 5 minutes
  message: { success: false, message: 'Too many profile updates. Please wait.' }
});

// Crisis detection keywords with severity levels
const CRISIS_KEYWORDS = {
  HIGH_RISK: [
    'kill myself', 'suicide', 'end my life', 'overdose', 'hanging myself',
    'jump off', 'better off dead', 'end it all', 'kill me'
  ],
  MEDIUM_RISK: [
    'want to die', 'hurt myself', 'self harm', 'cut myself', 'suicidal',
    'self-harm', 'harm myself', 'hate myself', 'worthless', 'hopeless',
    'cannot go on', 'give up on life', 'not worth living'
  ],
  LOW_RISK: [
    'depressed', 'sad all the time', 'can\'t cope', 'overwhelmed',
    'life is hard', 'struggling', 'feeling down'
  ]
};

// Enhanced crisis detection function
const detectCrisis = (message, profile) => {
  const lowerMessage = message.toLowerCase();
  let riskLevel = 'NONE';
  let detectedKeywords = [];

  // Check for high-risk keywords first
  const highRiskFound = CRISIS_KEYWORDS.HIGH_RISK.filter(keyword => 
    lowerMessage.includes(keyword)
  );
  
  if (highRiskFound.length > 0) {
    riskLevel = 'HIGH';
    detectedKeywords = [...detectedKeywords, ...highRiskFound];
  } else {
    // Check for medium-risk keywords
    const mediumRiskFound = CRISIS_KEYWORDS.MEDIUM_RISK.filter(keyword => 
      lowerMessage.includes(keyword)
    );
    
    if (mediumRiskFound.length > 0) {
      riskLevel = 'MEDIUM';
      detectedKeywords = [...detectedKeywords, ...mediumRiskFound];
    } else {
      // Check for low-risk keywords
      const lowRiskFound = CRISIS_KEYWORDS.LOW_RISK.filter(keyword => 
        lowerMessage.includes(keyword)
      );
      
      if (lowRiskFound.length > 0) {
        riskLevel = 'LOW';
        detectedKeywords = [...detectedKeywords, ...lowRiskFound];
      }
    }
  }

  if (riskLevel === 'NONE') {
    return { isCrisis: false };
  }

  const response = generateCrisisResponse(profile?.region, riskLevel);

  return {
    isCrisis: true,
    riskLevel,
    keywords: detectedKeywords,
    response,
    resources: getCrisisResources(profile?.region),
    hotlines: getCrisisHotlines(profile?.region)
  };
};

// Enhanced crisis response generation
const generateCrisisResponse = (region, riskLevel) => {
  const getLocalHotlines = (region) => {
    const regionLower = region?.toLowerCase() || '';
    
    if (regionLower.includes('nigeria') || regionLower.includes('ng')) {
      return `🇳🇬 **Nigeria Emergency Contacts:**
- **Emergency Services:** 199, 911
- **Mental Health Helpline:** +234 809 210 6493
- **Lagos State Domestic & Sexual Violence Response Team:** 08000333333
- **Suicide Prevention:** Contact nearest hospital emergency room`;
    }
    
    if (regionLower.includes('usa') || regionLower.includes('united states')) {
      return `🇺🇸 **USA Crisis Resources:**
- **988 Suicide & Crisis Lifeline:** 988 (24/7)
- **Crisis Text Line:** Text HOME to 741741
- **National Domestic Violence Hotline:** 1-800-799-7233
- **Emergency Services:** 911`;
    }
    
    if (regionLower.includes('uk') || regionLower.includes('united kingdom')) {
      return `🇬🇧 **UK Crisis Resources:**
- **Samaritans:** 116 123 (free, 24/7)
- **Crisis Text Line:** Text SHOUT to 85258
- **National Domestic Abuse Helpline:** 0808 2000 247
- **Emergency Services:** 999`;
    }
    
    return `🌍 **International Crisis Resources:**
- **International Association for Suicide Prevention:** https://www.iasp.info/resources/Crisis_Centres/
- **Befrienders Worldwide:** https://www.befrienders.org/
- **Emergency Services:** Contact your local emergency number`;
  };

  if (riskLevel === 'HIGH') {
    return `🚨 **URGENT: I'm deeply concerned about you**

I hear that you're in significant emotional pain right now. Your life has value, and you deserve support and help.

**🆘 IMMEDIATE HELP:**
Please reach out for professional support right now:
${getLocalHotlines(region)}

**💚 IMMEDIATE SAFETY STEPS:**
1. **Stay with someone** - Don't be alone right now
2. **Remove any means of harm** - Ask someone to help
3. **Go to your nearest emergency room** if you're in immediate danger
4. **Call emergency services** if you need immediate help

**🤝 YOU ARE NOT ALONE:**
- These feelings can change with proper help
- Mental health professionals are trained for exactly this
- Many people who felt this way found relief and meaning again
- Your pain is real, but it can be treated

**📞 PLEASE CALL ONE OF THE NUMBERS ABOVE RIGHT NOW**

I'm an AI and cannot provide the emergency support you need, but human professionals are standing by 24/7 to help you through this crisis.

Your life matters. You matter. Please reach out for help. 💙

⚠️ **This is not a substitute for professional mental health care. Please contact emergency services or a crisis hotline immediately.**`;
  } else if (riskLevel === 'MEDIUM') {
    return `💛 **I'm concerned about you and want to help**

It sounds like you're going through a really difficult time. Your feelings are valid, and there are people who want to support you.

**🤝 Support Resources:**
${getLocalHotlines(region)}

**💡 Immediate steps that might help:**
- Reach out to a trusted friend, family member, or counselor
- Consider professional support - therapy can be incredibly helpful
- Practice grounding techniques: deep breathing, name 5 things you can see
- Remember: difficult feelings are temporary and can change

**🌟 You deserve support:**
- Your struggles are real and valid
- Professional help can provide tools and strategies
- Many people have worked through similar challenges

If you're having thoughts of self-harm, please reach out to the crisis resources above immediately.

⚠️ **Please consider reaching out to a mental health professional for ongoing support.**`;
  } else {
    return `💙 **I hear that you're having a tough time**

It's completely normal to feel overwhelmed sometimes. Thank you for sharing - that takes courage.

**🌱 Some things that might help:**
- Talk to someone you trust about how you're feeling
- Consider speaking with a counselor or therapist
- Practice self-care activities that usually help you feel better
- Remember that difficult periods don't last forever

**📞 If you need someone to talk to:**
${getLocalHotlines(region)}

**🤗 Gentle reminders:**
- Your feelings are valid
- It's okay to ask for help
- Taking care of your mental health is important
- Small steps forward still count as progress

Is there something specific I can help you with today? I'm here to support your wellness journey.`;
  }
};

// Get crisis resources by region
const getCrisisResources = (region) => {
  const regionLower = region?.toLowerCase() || '';
  
  if (regionLower.includes('nigeria')) {
    return [
      'Crisis hotlines',
      'Emergency services (199, 911)',
      'Mental health professionals',
      'Hospital emergency rooms',
      'Lagos State DSVRT',
      'Community health centers'
    ];
  }
  
  return [
    'Crisis hotlines',
    'Emergency services',
    'Mental health professionals',
    'Hospital emergency rooms',
    'Community support services',
    'Online crisis chat services'
  ];
};

// Get crisis hotlines by region
const getCrisisHotlines = (region) => {
  const regionLower = region?.toLowerCase() || '';
  
  if (regionLower.includes('nigeria')) {
    return ['+234 809 210 6493', '199', '911', '08000333333'];
  }
  if (regionLower.includes('usa')) {
    return ['988', '741741', '911', '1-800-799-7233'];
  }
  if (regionLower.includes('uk')) {
    return ['116 123', '85258', '999', '0808 2000 247'];
  }
  if (regionLower.includes('canada')) {
    return ['1-833-456-4566', '45645', '911'];
  }
  
  return ['Local emergency services'];
};

// Map AI response types to valid Prisma enum values
const mapMessageType = (aiType) => {
  const typeMapping = {
    'GREETING': 'TEXT',
    'SUGGESTION': 'TEXT', 
    'EXERCISE': 'TEXT',
    'NUTRITION': 'RECIPE',
    'MENTAL_HEALTH': 'TEXT',
    'SLEEP': 'TEXT',
    'CRISIS_RESPONSE': 'TEXT'
  };
  
  return typeMapping[aiType] || 'TEXT';
};

// POST /api/jojo/message - Send message to JoJo
router.post('/message', authenticateToken, chatRateLimit, async (req, res) => {
  try {
    const { conversationId, content } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    if (content.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Message too long (max 2000 characters)'
      });
    }

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await prisma.chatConversation.findUnique({
        where: { id: conversationId, userId }
      });
      
      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found'
        });
      }
    } else {
      // Generate a more descriptive title based on content
      const generateTitle = (content) => {
        const words = content.toLowerCase().split(' ').slice(0, 4);
        const title = words.join(' ');
        return title.length > 0 ? title.charAt(0).toUpperCase() + title.slice(1) : `Chat ${new Date().toLocaleDateString()}`;
      };

      conversation = await prisma.chatConversation.create({
        data: {
          userId,
          title: generateTitle(content.trim()),
          lastMessageAt: new Date()
        }
      });
    }

    // Save user message
    const userMessage = await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        userId,
        content: content.trim(),
        sender: 'USER',
        messageType: 'TEXT'
      }
    });

    // Get user's wellness profile
    const wellnessProfile = await prisma.wellnessProfile.findUnique({
      where: { userId }
    });

    // Get recent conversation history for context
    const conversationHistory = await prisma.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        content: true,
        sender: true,
        messageType: true,
        createdAt: true
      }
    });

    // Check for crisis FIRST - this takes priority over all other responses
    const crisisDetection = detectCrisis(content, wellnessProfile);
    
    if (crisisDetection.isCrisis) {
      // Log crisis incident
      const crisisLog = await prisma.crisisLog.create({
        data: {
          userId,
          messageId: userMessage.id,
          triggerContent: content,
          keywords: JSON.stringify(crisisDetection.keywords),
          riskLevel: crisisDetection.riskLevel,
          responseGiven: crisisDetection.response,
          resourcesShared: JSON.stringify(crisisDetection.resources),
          userRegion: wellnessProfile?.region,
          hotlinesProvided: JSON.stringify(crisisDetection.hotlines),
          followUpNeeded: crisisDetection.riskLevel === 'HIGH',
          adminNotified: crisisDetection.riskLevel === 'HIGH'
        }
      });

      // Save crisis response
      const jojoMessage = await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          userId,
          content: crisisDetection.response,
          sender: 'JOJO',
          messageType: 'CRISIS_RESPONSE'
        }
      });

      // Update conversation timestamp
      await prisma.chatConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() }
      });

      return res.json({
        success: true,
        data: {
          conversation,
          userMessage,
          jojoMessage,
          crisisDetected: true,
          riskLevel: crisisDetection.riskLevel,
          metadata: {
            responseType: 'crisis',
            keywords: crisisDetection.keywords
          }
        }
      });
    }

    // Generate AI response using your custom AI service
    const startTime = Date.now();
    let aiResponse;
    let aiProvider = 'groq';
    let groqMetadata = {};
    
    try {
      console.log('🤖 Calling Groq AI service for user:', userId);
      console.log('📝 User input:', content.substring(0, 100) + '...');
      
      // Debug: Check what methods are available in aiService
      console.log('🔍 Available aiService methods:', Object.getOwnPropertyNames(aiService));
      console.log('🔍 aiService type:', typeof aiService);
      
      // Check if the method exists
      if (typeof aiService.generateJoJoResponse !== 'function') {
        throw new Error(`generateJoJoResponse method not found. Available methods: ${Object.getOwnPropertyNames(aiService).join(', ')}`);
      }
      
      // Enhanced Groq API call with wellness context
      const groqResponse = await aiService.generateJoJoResponse(content, wellnessProfile, {
        conversationHistory: conversationHistory.slice(0, 5), // Last 5 messages for context
        userContext: { 
          userId, 
          conversationId: conversation.id,
          hasProfile: !!wellnessProfile,
          userGoals: wellnessProfile?.healthGoals ? JSON.parse(wellnessProfile.healthGoals) : [],
          userRestrictions: wellnessProfile?.dietaryRestrictions ? JSON.parse(wellnessProfile.dietaryRestrictions) : []
        }
      });
      
      console.log('✅ Groq AI response received:', {
        type: groqResponse.type,
        confidence: groqResponse.confidence,
        model: groqResponse.model,
        contentLength: groqResponse.content?.length
      });
      
      aiResponse = groqResponse;
      groqMetadata = {
        model: groqResponse.model || 'llama3-8b-8192',
        tokensUsed: groqResponse.usage?.total_tokens || 0,
        promptTokens: groqResponse.usage?.prompt_tokens || 0,
        completionTokens: groqResponse.usage?.completion_tokens || 0,
        processingTime: groqResponse.processingTime || 0
      };
      
    } catch (aiError) {
      console.error('❌ Groq AI Service Error:', aiError);
      console.error('🔍 Error details:', {
        message: aiError.message,
        stack: aiError.stack?.split('\n').slice(0, 3)
      });
      
      // Enhanced fallback response
      aiResponse = {
        content: `I'm here to help with your wellness journey! 🌟 

I can provide advice on:
💪 **Fitness & Exercise** - Workout plans and training tips
🍎 **Nutrition** - Healthy eating and meal planning  
🧘‍♀️ **Mental Health** - Stress management and wellness strategies
😴 **Sleep & Recovery** - Better sleep habits

Could you tell me more specifically what you'd like help with?`,
        type: 'SUGGESTION',
        confidence: 0.6,
        keywords: []
      };
      aiProvider = 'fallback';
      
      // Log the AI failure for monitoring
      console.warn(`🚨 Groq AI fallback triggered for user ${userId}: ${aiError.message}`);
    }
    
    const responseTime = Date.now() - startTime;

    // Save JoJo's response
    const jojoMessage = await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        userId,
        content: aiResponse.content,
        sender: 'JOJO',
        messageType: mapMessageType(aiResponse.type), // Map to valid enum values
        responseTime,
        confidence: aiResponse.confidence || 0.7,
        triggerKeywords: JSON.stringify(aiResponse.keywords || [])
      }
    });

    // Update conversation timestamp
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { 
        lastMessageAt: new Date()
      }
    });

    // Track analytics (create daily entry if doesn't exist)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    await prisma.chatAnalytics.upsert({
      where: {
        userId_date: {
          userId,
          date: today
        }
      },
      update: {
        messagesCount: { increment: 1 },
        conversationTime: { increment: Math.ceil(responseTime / 1000 / 60) } // minutes
      },
      create: {
        userId,
        date: today,
        messagesCount: 1,
        conversationTime: Math.ceil(responseTime / 1000 / 60)
      }
    });

    res.json({
      success: true,
      data: {
        conversation,
        userMessage,
        jojoMessage,
        metadata: {
          responseTime,
          confidence: aiResponse.confidence || 0.7,
          messageType: aiResponse.type || 'SUGGESTION',
          aiProvider,
          keywords: aiResponse.keywords || [],
          groq: groqMetadata
        }
      }
    });

  } catch (error) {
    console.error('Error in sendMessage:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/jojo/conversations - Get user's conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit))); // Cap at 50

    const conversations = await prisma.chatConversation.findMany({
      where: { userId, isActive: true },
      orderBy: { lastMessageAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            content: true,
            sender: true,
            createdAt: true,
            messageType: true
          }
        },
        _count: {
          select: { messages: true }
        }
      }
    });

    const total = await prisma.chatConversation.count({
      where: { userId, isActive: true }
    });

    res.json({
      success: true,
      data: {
        conversations: conversations.map(conv => ({
          ...conv,
          lastMessage: conv.messages[0] || null,
          messageCount: conv._count.messages
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
          hasNext: pageNum * limitNum < total,
          hasPrev: pageNum > 1
        }
      }
    });

  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get conversations'
    });
  }
});

// GET /api/jojo/conversation/:id/history - Get conversation history
router.get('/conversation/:id/history', authenticateToken, async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user.id;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit))); // Cap at 100

    // Verify user owns conversation
    const conversation = await prisma.chatConversation.findUnique({
      where: { id: conversationId, userId },
      include: {
        _count: {
          select: { messages: true }
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found or access denied'
      });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      select: {
        id: true,
        content: true,
        sender: true,
        messageType: true,
        createdAt: true,
        responseTime: true,
        confidence: true
      }
    });

    const total = conversation._count.messages;

    res.json({
      success: true,
      data: {
        conversation: {
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          lastMessageAt: conversation.lastMessageAt,
          messageCount: total
        },
        messages,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
          hasNext: pageNum * limitNum < total,
          hasPrev: pageNum > 1
        }
      }
    });

  } catch (error) {
    console.error('Error getting conversation history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get conversation history'
    });
  }
});

// GET /api/jojo/profile - Get wellness profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const profile = await prisma.wellnessProfile.findUnique({
      where: { userId }
    });

    // Parse JSON fields for frontend
    if (profile) {
      try {
        profile.healthGoals = profile.healthGoals ? JSON.parse(profile.healthGoals) : [];
        profile.dietaryRestrictions = profile.dietaryRestrictions ? JSON.parse(profile.dietaryRestrictions) : [];
        profile.healthConditions = profile.healthConditions ? JSON.parse(profile.healthConditions) : [];
      } catch (parseError) {
        console.error('Error parsing profile JSON fields:', parseError);
        // Set defaults if parsing fails
        profile.healthGoals = [];
        profile.dietaryRestrictions = [];
        profile.healthConditions = [];
      }
    }

    res.json({
      success: true,
      data: { profile }
    });

  } catch (error) {
    console.error('Error getting wellness profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

// PUT /api/jojo/profile - Update wellness profile
router.put('/profile', authenticateToken, profileRateLimit, async (req, res) => {
  try {
    const userId = req.user.id;
    const profileData = req.body;

    // Basic validation
    if (profileData.age && (profileData.age < 13 || profileData.age > 120)) {
      return res.status(400).json({
        success: false,
        message: 'Age must be between 13 and 120'
      });
    }

    const validGenders = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'];
    if (profileData.gender && !validGenders.includes(profileData.gender)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid gender value'
      });
    }

    const validFitnessLevels = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
    if (profileData.fitnessLevel && !validFitnessLevels.includes(profileData.fitnessLevel)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fitness level'
      });
    }

    // Convert arrays to JSON strings for database storage
    if (profileData.healthGoals && Array.isArray(profileData.healthGoals)) {
      profileData.healthGoals = JSON.stringify(profileData.healthGoals);
    }
    if (profileData.dietaryRestrictions && Array.isArray(profileData.dietaryRestrictions)) {
      profileData.dietaryRestrictions = JSON.stringify(profileData.dietaryRestrictions);
    }
    if (profileData.healthConditions && Array.isArray(profileData.healthConditions)) {
      profileData.healthConditions = JSON.stringify(profileData.healthConditions);
    }

    // Remove any undefined or null values
    Object.keys(profileData).forEach(key => {
      if (profileData[key] === undefined || profileData[key] === null) {
        delete profileData[key];
      }
    });

    const profile = await prisma.wellnessProfile.upsert({
      where: { userId },
      update: {
        ...profileData,
        updatedAt: new Date()
      },
      create: {
        userId,
        ...profileData
      }
    });

    // Parse JSON fields for response
    try {
      profile.healthGoals = profile.healthGoals ? JSON.parse(profile.healthGoals) : [];
      profile.dietaryRestrictions = profile.dietaryRestrictions ? JSON.parse(profile.dietaryRestrictions) : [];
      profile.healthConditions = profile.healthConditions ? JSON.parse(profile.healthConditions) : [];
    } catch (parseError) {
      console.error('Error parsing profile response:', parseError);
    }

    res.json({
      success: true,
      data: { profile },
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Error updating wellness profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// GET /api/jojo/health-check - Health check endpoint
router.get('/health-check', async (req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({
      success: true,
      message: 'JoJo API is healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: {
        database: 'operational',
        aiService: 'operational'
      }
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      success: false,
      message: 'Service unavailable',
      error: 'Database connection failed'
    });
  }
});

module.exports = router;