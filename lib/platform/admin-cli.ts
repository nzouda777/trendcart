/**
 * Platform admin accounts, from the terminal only:
 *
 *   pnpm admin:create --email you@company.com --name "Your Name"
 *   pnpm admin:create                                 (asks for the email and name)
 *   pnpm admin:password --email you@company.com      (reset a forgotten password)
 *
 * The password is typed (hidden) twice, never passed as an argument (it would
 * stay in the shell history). Uses DATABASE_URL (.env.local when present):
 * point it at production to create the production admin. An existing user
 * with that email is promoted to admin and gets the new password.
 */
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { openDatabase } from "../db/cli-db";
import { account, platformAuditLog, user } from "../db/schema";

const MIN_PASSWORD = 12;

/** Reads a visible line from the terminal. */
async function askLine(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Missing arguments: pnpm admin:create --email <email> --name <name> (run it in an interactive terminal).",
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("Run this command in an interactive terminal (the password is typed)."));
      return;
    }
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function askPassword(): Promise<string> {
  const first = await askHidden(`Password (at least ${MIN_PASSWORD} characters): `);
  if (first.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
  const second = await askHidden("Repeat the password: ");
  if (first !== second) throw new Error("The two passwords differ.");
  return first;
}

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: { email: { type: "string" }, name: { type: "string" } },
  });
  const email = (values.email?.trim() || (await askLine("Admin email: "))).toLowerCase();
  if (command !== "create" && command !== "password") {
    throw new Error(
      "Usage: pnpm admin:create --email <email> --name <name> | pnpm admin:password --email <email>",
    );
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Enter a valid email (or pass --email <email>).");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");

  const { db, close } = await openDatabase(url);
  try {
    const [existing] = await db.select().from(user).where(eq(user.email, email)).limit(1);
    if (command === "password" && existing?.role !== "admin") {
      throw new Error(`${email} is not a platform admin.`);
    }
    const name = values.name?.trim() || existing?.name || (await askLine("Admin name: "));
    if (!name) throw new Error("Enter a name (or pass --name <name>).");
    console.info(
      existing
        ? `${command === "create" ? "Promoting" : "Resetting the password of"} ${email} (${url.startsWith("pglite") ? "local database" : "remote database"}).`
        : `Creating the admin ${email} (${url.startsWith("pglite") ? "local database" : "remote database"}).`,
    );
    const passwordHash = await hashPassword(await askPassword());
    const now = new Date();

    await db.transaction(async (tx) => {
      let userId = existing?.id;
      if (existing) {
        await tx
          .update(user)
          .set({ role: "admin", name, emailVerified: true, banned: false, updatedAt: now })
          .where(eq(user.id, existing.id));
      } else {
        userId = crypto.randomUUID();
        await tx.insert(user).values({
          id: userId,
          name,
          email,
          emailVerified: true,
          role: "admin",
          createdAt: now,
          updatedAt: now,
        });
      }
      const [credential] = await tx
        .select()
        .from(account)
        .where(and(eq(account.userId, userId!), eq(account.providerId, "credential")))
        .limit(1);
      if (credential) {
        await tx
          .update(account)
          .set({ password: passwordHash, updatedAt: now })
          .where(eq(account.id, credential.id));
      } else {
        await tx.insert(account).values({
          id: crypto.randomUUID(),
          accountId: userId!,
          providerId: "credential",
          userId: userId!,
          password: passwordHash,
          createdAt: now,
          updatedAt: now,
        });
      }
      await tx.insert(platformAuditLog).values({
        adminUserId: userId!,
        action: command === "create" ? "admin.create_cli" : "admin.password_reset_cli",
        targetType: "user",
        targetId: userId!,
        metadata: { email },
      });
    });
    console.info(`Done. Sign in at /sign-in with ${email}, then open /admin.`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
