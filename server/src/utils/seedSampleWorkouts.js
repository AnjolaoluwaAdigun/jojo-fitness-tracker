const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seedSampleWorkouts(userId) {
  try {
    console.log('🏋️ Creating sample workouts for analytics testing...');

    // Get some exercises to use
    const exercises = await prisma.exercise.findMany({
      take: 10
    });

    if (exercises.length === 0) {
      console.log('❌ No exercises found. Please run exercise seeding first.');
      return;
    }

    const benchPress = exercises.find(e => e.name.includes('Bench'));
    const squat = exercises.find(e => e.name.includes('Squat'));
    const pullups = exercises.find(e => e.name.includes('Pull'));

    // Create sample workouts over the past 4 weeks
    const sampleWorkouts = [];
    
    for (let week = 4; week >= 1; week--) {
      for (let workout = 0; workout < 3; workout++) {
        const date = new Date();
        date.setDate(date.getDate() - (week * 7) + (workout * 2));
        
        sampleWorkouts.push({
          name: ['Push Day', 'Pull Day', 'Leg Day'][workout],
          date,
          duration: 45 + Math.floor(Math.random() * 30), // 45-75 minutes
          notes: 'Sample workout for testing',
          userId,
          exercises: workout === 0 ? [
            // Push Day
            {
              exerciseId: benchPress?.id || exercises[0].id,
              sets: 3,
              reps: [8, 8, 6],
              weight: [135 + (week * 5), 135 + (week * 5), 145 + (week * 5)],
              restTime: 180
            }
          ] : workout === 1 ? [
            // Pull Day
            {
              exerciseId: pullups?.id || exercises[1].id,
              sets: 3,
              reps: [8, 7, 6],
              weight: [0, 0, 0], // Bodyweight
              restTime: 120
            }
          ] : [
            // Leg Day
            {
              exerciseId: squat?.id || exercises[2].id,
              sets: 3,
              reps: [10, 8, 6],
              weight: [185 + (week * 10), 205 + (week * 10), 225 + (week * 10)],
              restTime: 240
            }
          ]
        });
      }
    }

    // Create workouts with exercises
    for (const workoutData of sampleWorkouts) {
      const workout = await prisma.workout.create({
        data: {
          name: workoutData.name,
          date: workoutData.date,
          duration: workoutData.duration,
          notes: workoutData.notes,
          userId: workoutData.userId
        }
      });

      // Add exercises to workout
      for (const exerciseData of workoutData.exercises) {
        await prisma.workoutExercise.create({
          data: {
            workoutId: workout.id,
            exerciseId: exerciseData.exerciseId,
            sets: exerciseData.sets,
            reps: exerciseData.reps,
            weight: exerciseData.weight,
            restTime: exerciseData.restTime
          }
        });
      }

      console.log(`✅ Created workout: ${workout.name} on ${workout.date.toDateString()}`);
    }

    console.log(`🎉 Successfully created ${sampleWorkouts.length} sample workouts!`);
  } catch (error) {
    console.error('❌ Error seeding sample workouts:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Export for use in other scripts
module.exports = { seedSampleWorkouts };

// If run directly, prompt for user ID
if (require.main === module) {
  const userId = process.argv[2];
  if (!userId) {
    console.log('Usage: node seedSampleWorkouts.js <userId>');
    console.log('Your user ID is: cmbs14wsg0000v0ewwegf3w97');
    process.exit(1);
  }
  seedSampleWorkouts(userId);
}