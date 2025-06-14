const axios = require('axios');

class AIService {
  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY;
    this.baseUrl = 'https://api.groq.com/openai/v1/chat/completions';
    
    // Model configurations
    this.models = {
      primary: 'llama3-8b-8192',      // Fast and efficient
      advanced: 'llama3-70b-8192',   // More capable
      crisis: 'llama3-70b-8192'      // Best for crisis situations
    };
    
    // Default settings
    this.defaultSettings = {
      maxTokens: 800,
      temperature: 0.7,
      topP: 0.9,
      frequencyPenalty: 0.1,
      presencePenalty: 0.1
    };
    
    console.log('✅ AI Service initialized with Groq API');
  }

  // Main method to generate JoJo's response
  async generateJoJoResponse(userInput, wellnessProfile = null, context = {}) {
    const startTime = Date.now();
    
    try {
      console.log('🔄 Generating JoJo response for input:', userInput.substring(0, 50) + '...');
      
      const { 
        conversationHistory = [], 
        userContext = {}
      } = context;
      
      // Create the system prompt
      const systemPrompt = this.createSystemPrompt(wellnessProfile, userContext);
      
      // Format conversation history
      const messages = [
        { role: 'system', content: systemPrompt },
        ...this.formatConversationHistory(conversationHistory),
        { role: 'user', content: userInput }
      ];

      // Call Groq API
      const response = await axios.post(this.baseUrl, {
        model: this.models.primary,
        messages: messages,
        max_tokens: this.defaultSettings.maxTokens,
        temperature: this.defaultSettings.temperature,
        top_p: this.defaultSettings.topP,
        frequency_penalty: this.defaultSettings.frequencyPenalty,
        presence_penalty: this.defaultSettings.presencePenalty
      }, {
        headers: {
          'Authorization': `Bearer ${this.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const processingTime = Date.now() - startTime;
      const aiResponse = response.data.choices[0].message.content;

      console.log('✅ Groq API response received:', {
        length: aiResponse.length,
        model: response.data.model,
        usage: response.data.usage
      });

      // Analyze the response
      const analysis = this.analyzeResponse(aiResponse, userInput, wellnessProfile);

      return {
        content: aiResponse,
        type: analysis.type,
        confidence: analysis.confidence,
        keywords: analysis.keywords,
        topics: analysis.topics,
        followUp: analysis.followUp,
        model: response.data.model,
        usage: response.data.usage,
        processingTime
      };

    } catch (error) {
      console.error('❌ Error generating AI response:', error.message);
      
      const fallback = this.getFallbackResponse(userInput, wellnessProfile);
      
      return {
        ...fallback,
        processingTime: Date.now() - startTime,
        error: error.message,
        fallbackUsed: true
      };
    }
  }

  // Create system prompt based on user profile
  createSystemPrompt(profile, userContext = {}) {
    const basePrompt = `You are JoJo, a friendly and knowledgeable AI wellness coach. Your role is to provide helpful, personalized advice on fitness, nutrition, and mental health.

PERSONALITY:
- Warm, encouraging, and supportive
- Use emojis appropriately to make conversations engaging (2-3 per response)
- Be conversational but professional
- Always prioritize user safety and well-being

CAPABILITIES:
- Fitness advice and workout planning
- Nutrition guidance and meal planning
- Mental health support and stress management
- Sleep optimization tips
- General wellness coaching

RESPONSE GUIDELINES:
- Provide actionable, specific advice
- Keep responses concise but helpful (150-300 words)
- Use clear formatting when helpful
- Always consider user safety and limitations

SAFETY GUIDELINES:
- Always recommend consulting healthcare professionals for serious concerns
- Never provide medical diagnoses
- If someone mentions self-harm or suicide, provide immediate crisis resources
- Be culturally sensitive and inclusive`;

    // Add personalization based on profile
    if (profile) {
      let personalization = '\n\n📋 USER PROFILE:\n';
      
      if (profile.age) personalization += `- Age: ${profile.age}\n`;
      if (profile.gender) personalization += `- Gender: ${profile.gender}\n`;
      if (profile.region) personalization += `- Region: ${profile.region}\n`;
      if (profile.fitnessLevel) personalization += `- Fitness Level: ${profile.fitnessLevel}\n`;
      if (profile.incomeLevel) personalization += `- Budget Level: ${profile.incomeLevel}\n`;
      
      if (profile.healthGoals) {
        const goals = this.parseJsonField(profile.healthGoals);
        if (goals.length > 0) personalization += `- Health Goals: ${goals.join(', ')}\n`;
      }
      
      if (profile.dietaryRestrictions) {
        const restrictions = this.parseJsonField(profile.dietaryRestrictions);
        if (restrictions.length > 0) personalization += `- Dietary Restrictions: ${restrictions.join(', ')}\n`;
      }

      personalization += '\nPlease tailor your advice based on this profile information.';
      
      return basePrompt + personalization;
    }

    return basePrompt + '\n\n💡 No user profile available. Provide general wellness advice and suggest profile completion for personalized recommendations.';
  }

  // Helper method to safely parse JSON fields
  parseJsonField(field) {
    if (!field) return [];
    if (Array.isArray(field)) return field;
    try {
      return JSON.parse(field);
    } catch {
      return [];
    }
  }

  // Format conversation history for AI context
  formatConversationHistory(history) {
    return history.slice(-5).map(msg => ({
      role: msg.sender === 'USER' ? 'user' : 'assistant',
      content: msg.content.length > 1000 ? msg.content.substring(0, 1000) + '...' : msg.content
    }));
  }

  // Analyze AI response to determine message type and extract metadata
  analyzeResponse(response, userInput, profile) {
    const input = userInput.toLowerCase();
    const content = response.toLowerCase();
    
    let type = 'SUGGESTION';
    let topics = [];
    let keywords = [];
    let confidence = 0.85;

    // Determine message type based on content
    if (content.includes('workout') || content.includes('exercise') || content.includes('training') || content.includes('fitness')) {
      type = 'EXERCISE';
      topics.push('fitness');
    }
    
    if (content.includes('nutrition') || content.includes('meal') || content.includes('diet') || 
        content.includes('food') || content.includes('recipe') || content.includes('calories')) {
      type = 'NUTRITION';
      topics.push('nutrition');
    }
    
    if (content.includes('stress') || content.includes('anxiety') || content.includes('mental') || 
        content.includes('meditation') || content.includes('mindfulness')) {
      type = 'MENTAL_HEALTH';
      topics.push('mental_health');
    }
    
    if (content.includes('sleep') || content.includes('rest') || content.includes('recovery')) {
      type = 'SLEEP';
      topics.push('sleep');
    }

    // Greeting detection
    if (input.includes('hello') || input.includes('hi') || input.includes('hey')) {
      type = 'GREETING';
      topics.push('introduction');
    }

    // Extract keywords from user input
    const keywordRegex = /\b(weight|loss|muscle|fitness|nutrition|stress|anxiety|sleep|workout|exercise|diet|mental|health|meditation|yoga|strength|cardio|protein|calories|goal|plan)\b/gi;
    keywords = [...new Set((userInput.match(keywordRegex) || []).map(k => k.toLowerCase()))];

    return {
      type,
      topics,
      keywords,
      confidence,
      followUp: null
    };
  }

  // Fallback response if AI fails
  getFallbackResponse(userInput, profile = null) {
    const userName = profile?.firstName || '';
    const greeting = userName ? `Hi ${userName}! ` : 'Hi there! ';
    
    return {
      content: `${greeting}I'm here to help with your wellness journey! 🌟 

I can provide personalized advice on:
💪 **Fitness & Exercise** - Workout plans, form tips, progression strategies
🍎 **Nutrition** - Meal planning, healthy eating, budget-friendly options  
🧘‍♀️ **Mental Health** - Stress management, mindfulness, emotional wellness
😴 **Sleep & Recovery** - Better sleep habits and rest optimization

Could you tell me more specifically what you'd like help with? For example:
- "I want to start working out but don't know where to begin"
- "Help me plan healthy meals on a budget"
- "I'm feeling stressed and need coping strategies"
- "How can I improve my sleep quality?"

I'm here to support your wellness goals with practical, actionable advice! 💚`,
      type: 'SUGGESTION',
      confidence: 0.6,
      keywords: [],
      topics: ['general'],
      followUp: ['What specific wellness area would you like to focus on first?']
    };
  }

  // Test connection (for health checks)
  async testGroqConnection(testPrompt = "Hello", options = {}) {
    const { timeout = 5000 } = options;
    
    try {
      const response = await axios.post(this.baseUrl, {
        model: this.models.primary,
        messages: [{ role: 'user', content: testPrompt }],
        max_tokens: 50
      }, {
        headers: {
          'Authorization': `Bearer ${this.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout
      });

      return response.data;

    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      throw new Error(`Groq connection test failed: ${errorMessage}`);
    }
  }
}

// Export a new instance of the service
module.exports = new AIService();