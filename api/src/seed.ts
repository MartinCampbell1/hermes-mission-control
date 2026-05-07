import AppDataSource from './data-source';
import { User } from './entities';

const DEFAULT_BOOTSTRAP_EMAIL = 'admin@local.hermes';

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

export default async function seedAdminUser(): Promise<void> {
  const userRepo = AppDataSource.getRepository(User);
  const activeUsersCount = await userRepo.count({ where: { active: true } });
  if (activeUsersCount > 0) return;

  const password = envValue('HERMES_CLIENT_BOOTSTRAP_PASSWORD');
  if (!password) {
    console.warn(
      '[auth] No active users and HERMES_CLIENT_BOOTSTRAP_PASSWORD is unset; bootstrap user was not created. Run npm run setup or set the variable in api/.env.'
    );
    return;
  }

  const admin = userRepo.create({
    email: envValue('HERMES_CLIENT_BOOTSTRAP_EMAIL') || DEFAULT_BOOTSTRAP_EMAIL,
    password,
    name: envValue('HERMES_CLIENT_BOOTSTRAP_NAME') || 'Admin',
    lastName: envValue('HERMES_CLIENT_BOOTSTRAP_LAST_NAME') || 'User',
    phone: envValue('HERMES_CLIENT_BOOTSTRAP_PHONE'),
    active: true,
    createdAt: new Date(),
  });
  await userRepo.save(admin);
}
