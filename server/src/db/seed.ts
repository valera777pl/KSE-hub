import { db } from './connection.js';
import { rooms, opportunities } from './schema.js';

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
  const opportunityData = [
    {
      title: 'Data Analyst Intern',
      company: 'Kyivstar',
      domain: 'Tech',
      eligibility: 'all' as const,
      category: 'internship' as const,
      deadline: new Date('2026-11-01'),
      url: 'https://kyivstar.ua/careers',
      description: 'Аналіз великих даних, побудова дашбордів, робота з SQL та Python.',
      salaryInfo: '15,000 UAH/month',
    },
    {
      title: 'Economic Research Assistant',
      company: 'KSE Institute',
      domain: 'Economics',
      eligibility: 'grant' as const,
      category: 'research' as const,
      deadline: new Date('2026-10-15'),
      url: 'https://kse.ua/research',
      description: 'Дослідження макроекономічних показників України. Потрібен досвід з Stata/R.',
      salaryInfo: '20,000 UAH/month',
    },
    {
      title: 'Junior Consultant',
      company: 'McKinsey & Company',
      domain: 'Consulting',
      eligibility: 'all' as const,
      category: 'job' as const,
      deadline: new Date('2026-12-01'),
      url: 'https://mckinsey.com/careers',
      description: 'Business analyst role for graduating students. Full-time position in Kyiv office.',
      salaryInfo: 'Competitive',
    },
    {
      title: 'Fulbright Student Program',
      company: 'Fulbright Ukraine',
      domain: 'Policy',
      eligibility: 'all' as const,
      category: 'grant' as const,
      deadline: new Date('2026-10-30'),
      url: 'https://fulbright.org.ua',
      description: 'Повне фінансування магістратури в університетах США.',
    },
    {
      title: 'Policy Intern — Verkhovna Rada',
      company: 'UNDP Ukraine',
      domain: 'Policy',
      eligibility: 'grant' as const,
      category: 'internship' as const,
      deadline: new Date('2026-11-15'),
      url: 'https://undp.org/ukraine',
      description: 'Стажування у комітетах Верховної Ради за підтримки UNDP.',
      salaryInfo: '12,000 UAH/month',
    },
    {
      title: 'Frontend Developer Intern',
      company: 'Genesis',
      domain: 'Tech',
      eligibility: 'contract' as const,
      category: 'internship' as const,
      deadline: new Date('2026-10-20'),
      url: 'https://gen.tech/careers',
      description: 'React/TypeScript, participation in product development.',
      salaryInfo: '18,000 UAH/month',
    },
  ];

  await db.insert(opportunities).values(opportunityData).onConflictDoNothing();
  console.log(`  ✅ Inserted ${opportunityData.length} opportunities`);

  console.log('🌱 Seeding complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
