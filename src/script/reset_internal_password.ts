import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { initDb } from "../server/db";
import { users } from "../shared/schema";

function generatePassword(): string {
  return crypto.randomBytes(9).toString("base64url");
}

async function main() {
  const db = await initDb();
  const email = process.argv[2];
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    console.error(`No account found for ${email}`);
    process.exit(1);
  }
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  console.log(`Reset password for ${email} (role: ${user.role})`);
  console.log(`New password: ${password}`);
  process.exit(0);
}
main();
