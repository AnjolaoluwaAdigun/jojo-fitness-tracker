const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const exercises = [
  // Chest Exercises
  {
    name: 'Bench Press',
    category: 'Strength',
    muscleGroups: ['Chest', 'Triceps', 'Shoulders'],
    instructions: 'Lie flat on bench, grip bar with hands slightly wider than shoulders, lower to chest, press up'
  },
  {
    name: 'Push-ups',
    category: 'Strength',
    muscleGroups: ['Chest', 'Triceps', 'Shoulders'],
    instructions: 'Start in plank position, lower body to ground, push back up'
  },
  {
    name: 'Incline Dumbbell Press',
    category: 'Strength',
    muscleGroups: ['Chest', 'Triceps', 'Shoulders'],
    instructions: 'Lie on inclined bench, press dumbbells from chest level upward'
  },
  {
    name: 'Chest Dips',
    category: 'Strength',
    muscleGroups: ['Chest', 'Triceps'],
    instructions: 'Support body on parallel bars, lower body by bending arms, push back up'
  },

  // Back Exercises
  {
    name: 'Pull-ups',
    category: 'Strength',
    muscleGroups: ['Back', 'Biceps'],
    instructions: 'Hang from bar with overhand grip, pull body up until chin over bar'
  },
  {
    name: 'Bent-over Row',
    category: 'Strength',
    muscleGroups: ['Back', 'Biceps'],
    instructions: 'Bend over with straight back, pull weight to lower chest'
  },
  {
    name: 'Lat Pulldown',
    category: 'Strength',
    muscleGroups: ['Back', 'Biceps'],
    instructions: 'Sit at machine, pull bar down to upper chest'
  },
  {
    name: 'Deadlift',
    category: 'Strength',
    muscleGroups: ['Back', 'Glutes', 'Hamstrings'],
    instructions: 'Stand with feet hip-width apart, bend to grip bar, lift by extending hips and knees'
  },

  // Leg Exercises
  {
    name: 'Squat',
    category: 'Strength',
    muscleGroups: ['Quadriceps', 'Glutes', 'Hamstrings'],
    instructions: 'Stand with feet shoulder-width apart, lower body by bending knees, return to standing'
  },
  {
    name: 'Lunges',
    category: 'Strength',
    muscleGroups: ['Quadriceps', 'Glutes', 'Hamstrings'],
    instructions: 'Step forward into lunge position, lower back knee toward ground, push back to standing'
  },
  {
    name: 'Leg Press',
    category: 'Strength',
    muscleGroups: ['Quadriceps', 'Glutes'],
    instructions: 'Sit in leg press machine, push weight away with legs'
  },
  {
    name: 'Calf Raises',
    category: 'Strength',
    muscleGroups: ['Calves'],
    instructions: 'Stand on balls of feet, raise heels as high as possible, lower slowly'
  },

  // Shoulder Exercises
  {
    name: 'Overhead Press',
    category: 'Strength',
    muscleGroups: ['Shoulders', 'Triceps'],
    instructions: 'Stand with feet hip-width apart, press weight overhead'
  },
  {
    name: 'Lateral Raises',
    category: 'Strength',
    muscleGroups: ['Shoulders'],
    instructions: 'Hold dumbbells at sides, raise arms out to shoulder height'
  },
  {
    name: 'Rear Delt Flyes',
    category: 'Strength',
    muscleGroups: ['Shoulders', 'Back'],
    instructions: 'Bend forward, raise arms out to sides squeezing shoulder blades'
  },

  // Arm Exercises
  {
    name: 'Bicep Curls',
    category: 'Strength',
    muscleGroups: ['Biceps'],
    instructions: 'Hold dumbbells at sides, curl weight up by bending elbow'
  },
  {
    name: 'Tricep Dips',
    category: 'Strength',
    muscleGroups: ['Triceps'],
    instructions: 'Support body on bench/chair, lower body by bending arms, push back up'
  },
  {
    name: 'Hammer Curls',
    category: 'Strength',
    muscleGroups: ['Biceps', 'Forearms'],
    instructions: 'Hold dumbbells with neutral grip, curl weight up'
  },

  // Core Exercises
  {
    name: 'Plank',
    category: 'Core',
    muscleGroups: ['Core', 'Shoulders'],
    instructions: 'Hold body in straight line supported by forearms and toes'
  },
  {
    name: 'Crunches',
    category: 'Core',
    muscleGroups: ['Core'],
    instructions: 'Lie on back, lift shoulders off ground by contracting abs'
  },
  {
    name: 'Russian Twists',
    category: 'Core',
    muscleGroups: ['Core', 'Obliques'],
    instructions: 'Sit with knees bent, lean back slightly, rotate torso side to side'
  },

  // Cardio Exercises
  {
    name: 'Running',
    category: 'Cardio',
    muscleGroups: ['Legs', 'Core'],
    instructions: 'Maintain steady pace, focus on breathing and form'
  },
  {
    name: 'Cycling',
    category: 'Cardio',
    muscleGroups: ['Legs', 'Core'],
    instructions: 'Pedal at consistent pace, adjust resistance as needed'
  },
  {
    name: 'Jump Rope',
    category: 'Cardio',
    muscleGroups: ['Legs', 'Core', 'Shoulders'],
    instructions: 'Jump over rope with both feet, maintain rhythm'
  },
  {
    name: 'Burpees',
    category: 'Cardio',
    muscleGroups: ['Full Body'],
    instructions: 'Squat down, jump back to plank, do push-up, jump forward, jump up'
  }
];

async function seedExercises() {
  try {
    console.log('🌱 Starting to seed exercises...');

    // Clear existing exercises (optional)
    await prisma.exercise.deleteMany({});
    console.log('🗑️  Cleared existing exercises');

    // Insert new exercises
    for (const exercise of exercises) {
      await prisma.exercise.create({
        data: exercise
      });
      console.log(`✅ Added: ${exercise.name}`);
    }

    console.log(`🎉 Successfully seeded ${exercises.length} exercises!`);
  } catch (error) {
    console.error('❌ Error seeding exercises:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeding function
if (require.main === module) {
  seedExercises();
}

module.exports = { seedExercises, exercises };