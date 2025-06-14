const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seedWorkoutTemplates() {
  try {
    console.log('🏋️ Creating popular workout templates...');

    // Get some exercises to use in templates
    const exercises = await prisma.exercise.findMany();
    
    if (exercises.length === 0) {
      console.log('❌ No exercises found. Please run exercise seeding first.');
      return;
    }

    // Helper function to find exercise by name
    const findExercise = (name) => exercises.find(e => 
      e.name.toLowerCase().includes(name.toLowerCase())
    );

    const templates = [
      {
        name: "Push Pull Legs (PPL)",
        description: "Classic 3-day split focusing on push muscles, pull muscles, and legs. Perfect for intermediate to advanced lifters.",
        category: "Strength",
        difficulty: "Intermediate",
        duration: 60,
        isPublic: true,
        exercises: [
          {
            exerciseId: findExercise("bench")?.id || exercises[0].id,
            order: 1,
            sets: 4,
            reps: [8, 8, 6, 6],
            restTime: 180,
            notes: "Focus on controlled movement"
          },
          {
            exerciseId: findExercise("press")?.id || exercises[1].id,
            order: 2,
            sets: 3,
            reps: [10, 10, 10],
            restTime: 120,
            notes: "Keep core engaged"
          },
          {
            exerciseId: findExercise("dips")?.id || exercises[2].id,
            order: 3,
            sets: 3,
            reps: [12, 10, 8],
            restTime: 90,
            notes: "Lean forward for chest emphasis"
          }
        ]
      },
      {
        name: "Starting Strength",
        description: "Beginner-friendly full-body routine focusing on compound movements. Based on Mark Rippetoe's program.",
        category: "Powerlifting",
        difficulty: "Beginner",
        duration: 45,
        isPublic: true,
        exercises: [
          {
            exerciseId: findExercise("squat")?.id || exercises[0].id,
            order: 1,
            sets: 3,
            reps: [5, 5, 5],
            restTime: 300,
            notes: "Focus on depth and form"
          },
          {
            exerciseId: findExercise("bench")?.id || exercises[1].id,
            order: 2,
            sets: 3,
            reps: [5, 5, 5],
            restTime: 180,
            notes: "Control the descent"
          },
          {
            exerciseId: findExercise("deadlift")?.id || exercises[2].id,
            order: 3,
            sets: 1,
            reps: [5],
            restTime: 300,
            notes: "Only one working set"
          }
        ]
      },
      {
        name: "Upper/Lower Split",
        description: "4-day split alternating between upper body and lower body workouts. Great for building strength and size.",
        category: "Bodybuilding",
        difficulty: "Intermediate",
        duration: 75,
        isPublic: true,
        exercises: [
          {
            exerciseId: findExercise("bench")?.id || exercises[0].id,
            order: 1,
            sets: 4,
            reps: [6, 8, 10, 12],
            restTime: 120,
            notes: "Pyramid training"
          },
          {
            exerciseId: findExercise("row")?.id || exercises[1].id,
            order: 2,
            sets: 4,
            reps: [8, 8, 8, 8],
            restTime: 120,
            notes: "Squeeze shoulder blades"
          },
          {
            exerciseId: findExercise("pull")?.id || exercises[2].id,
            order: 3,
            sets: 3,
            reps: [8, 8, 8],
            restTime: 90,
            notes: "Full range of motion"
          }
        ]
      },
      {
        name: "5/3/1 for Beginners",
        description: "Jim Wendler's 5/3/1 program adapted for beginners. Focuses on progressive overload with main lifts.",
        category: "Powerlifting",
        difficulty: "Intermediate",
        duration: 90,
        isPublic: true,
        exercises: [
          {
            exerciseId: findExercise("squat")?.id || exercises[0].id,
            order: 1,
            sets: 3,
            reps: [5, 3, 1],
            restTime: 300,
            notes: "Work up to heavy single"
          },
          {
            exerciseId: findExercise("bench")?.id || exercises[1].id,
            order: 2,
            sets: 5,
            reps: [5, 5, 5, 5, 5],
            restTime: 180,
            notes: "Follow-up volume work"
          }
        ]
      },
      {
        name: "Full Body Beginner",
        description: "Simple full-body routine perfect for beginners. Hits all major muscle groups in each session.",
        category: "Strength",
        difficulty: "Beginner",
        duration: 40,
        isPublic: true,
        exercises: [
          {
            exerciseId: findExercise("squat")?.id || exercises[0].id,
            order: 1,
            sets: 3,
            reps: [8, 8, 8],
            restTime: 180,
            notes: "Bodyweight or light weight"
          },
          {
            exerciseId: findExercise("push")?.id || exercises[1].id,
            order: 2,
            sets: 3,
            reps: [8, 8, 8],
            restTime: 120,
            notes: "Can be done on knees if needed"
          },
          {
            exerciseId: findExercise("plank")?.id || exercises[2].id,
            order: 3,
            sets: 3,
            reps: [30, 30, 30],
            restTime: 60,
            notes: "Hold for time (seconds)"
          }
        ]
      },
      {
        name: "HIIT Cardio Blast",
        description: "High-intensity interval training session. Perfect for burning calories and improving conditioning.",
        category: "Cardio",
        difficulty: "Intermediate",
        duration: 25,
        isPublic: true,
        exercises: [
          {
            exerciseId: findExercise("burpees")?.id || exercises[0].id,
            order: 1,
            sets: 4,
            reps: [10, 10, 10, 10],
            restTime: 30,
            notes: "30 seconds rest between sets"
          },
          {
            exerciseId: findExercise("jump")?.id || exercises[1].id,
            order: 2,
            sets: 4,
            reps: [60, 60, 60, 60],
            restTime: 30,
            notes: "60 seconds of jumping"
          },
          {
            exerciseId: findExercise("running")?.id || exercises[2].id,
            order: 3,
            sets: 1,
            reps: [300],
            restTime: 0,
            notes: "5-minute cool down"
          }
        ]
      }
    ];

    // Create templates
    for (const templateData of templates) {
      const template = await prisma.workoutTemplate.create({
        data: {
          name: templateData.name,
          description: templateData.description,
          category: templateData.category,
          difficulty: templateData.difficulty,
          duration: templateData.duration,
          isPublic: templateData.isPublic
        }
      });

      // Add exercises to template
      for (const exerciseData of templateData.exercises) {
        await prisma.templateExercise.create({
          data: {
            templateId: template.id,
            exerciseId: exerciseData.exerciseId,
            order: exerciseData.order,
            sets: exerciseData.sets,
            reps: exerciseData.reps,
            weight: exerciseData.weight || null,
            restTime: exerciseData.restTime,
            notes: exerciseData.notes
          }
        });
      }

      console.log(`✅ Created template: ${template.name}`);
    }

    console.log(`🎉 Successfully created ${templates.length} workout templates!`);
  } catch (error) {
    console.error('❌ Error seeding workout templates:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Export for use in other scripts
module.exports = { seedWorkoutTemplates };

// If run directly
if (require.main === module) {
  seedWorkoutTemplates();
}