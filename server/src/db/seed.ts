import { db } from './connection.js';
import { rooms } from './schema.js';

async function seed() {
  console.log('🌱 Seeding database...');

  // ── Seed Rooms ──
  const roomData = [
    { name: 'Skype Room 1 (2nd floor)', type: 'skype_room' as const, capacity: 4, hasDesk: true, hasPower: true, floor: 2 },
    { name: 'Skype Room 2 (2nd floor)', type: 'skype_room' as const, capacity: 4, hasDesk: true, hasPower: true, floor: 2 },
    { name: 'Skype Room 3 (3rd floor)', type: 'skype_room' as const, capacity: 6, hasDesk: true, hasPower: true, floor: 3 },
    { name: 'Skype Room 4 (3rd floor)', type: 'skype_room' as const, capacity: 2, hasDesk: false, hasPower: true, floor: 3 },
    { name: 'Silent Box A (1st floor)', type: 'silent_box' as const, capacity: 1, hasDesk: true, hasPower: true, floor: 1 },
    { name: 'Silent Box B (1st floor)', type: 'silent_box' as const, capacity: 1, hasDesk: true, hasPower: true, floor: 1 },
    { name: 'Silent Box C (2nd floor)', type: 'silent_box' as const, capacity: 1, hasDesk: true, hasPower: false, floor: 2 },
    { name: 'Silent Box D (3rd floor)', type: 'silent_box' as const, capacity: 2, hasDesk: true, hasPower: true, floor: 3 },
  ];

  await db.insert(rooms).values(roomData).onConflictDoNothing();
  console.log(`  ✅ Inserted ${roomData.length} rooms`);

  // ── Seed Opportunities ──
  // Opportunities come from students' emails (gmailService), no demo data

  console.log('🌱 Seeding complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
