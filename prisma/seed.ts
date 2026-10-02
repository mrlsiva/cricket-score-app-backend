/**
 * Seeds roles / permissions and promotes SUPER_ADMIN_EMAILS users.
 * (Roles are also ensured on every API boot, so this is safe to run repeatedly.)
 * Developed by Sling Groups
 */
import { PrismaClient, RoleName } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/common/constants/permissions';

const prisma = new PrismaClient();

async function main() {
  for (const [name, def] of Object.entries(DEFAULT_ROLE_PERMISSIONS) as [RoleName, (typeof DEFAULT_ROLE_PERMISSIONS)[RoleName]][]) {
    await prisma.role.upsert({
      where: { name },
      update: { description: def.description, permissions: def.permissions },
      create: { name, description: def.description, permissions: def.permissions },
    });
  }
  console.log(`Seeded ${Object.keys(DEFAULT_ROLE_PERMISSIONS).length} roles`);

  const emails = (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const admin = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.log(`- ${email}: not registered yet (will be promoted on first login)`);
      continue;
    }
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: admin.id } }, update: {}, create: { userId: user.id, roleId: admin.id } });
    console.log(`- ${email}: SUPER_ADMIN`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
