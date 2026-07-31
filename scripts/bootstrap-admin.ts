import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env.local");

function readFlag(name: string) {
  const position = process.argv.indexOf(`--${name}`);
  return position === -1 ? "" : (process.argv[position + 1] ?? "").trim();
}

const name = readFlag("name");
const email = readFlag("email").toLowerCase();
const password = readFlag("password");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!name || !email || password.length < 10) {
  throw new Error(
    "Provide --name, --email, and a --password of at least 10 characters.",
  );
}

if (!url || !secret) {
  throw new Error("Supabase URL or secret key is missing from .env.local.");
}

const supabase = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error || !data.user) {
  throw error ?? new Error("Unable to create the Admin account.");
}

const { error: profileError } = await supabase.from("profiles").insert({
  id: data.user.id,
  full_name: name,
  email,
  role: "admin",
  active: true,
  must_change_password: false,
});

if (profileError) {
  await supabase.auth.admin.deleteUser(data.user.id);
  throw profileError;
}

console.log(`Created Admin account for ${email}.`);
