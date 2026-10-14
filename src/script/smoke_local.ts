const baseUrl = (process.env.LIMURIA_BASE_URL || "http://127.0.0.1:5052").replace(/\/$/, "");

async function expectStatus(path: string, expected: number, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (response.status !== expected) {
    throw new Error(`${path}: expected ${expected}, received ${response.status}: ${await response.text()}`);
  }
  return response;
}

await expectStatus("/health", 200);
await expectStatus("/", 200);
await expectStatus("/api/auth/me", 401);

const email = process.env.LIMURIA_SMOKE_EMAIL;
const password = process.env.LIMURIA_SMOKE_PASSWORD;
if ((email && !password) || (!email && password)) {
  throw new Error("Set both LIMURIA_SMOKE_EMAIL and LIMURIA_SMOKE_PASSWORD, or neither.");
}

if (email && password) {
  const login = await expectStatus("/api/auth/login", 200, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Login succeeded without issuing a session cookie.");
  await expectStatus("/api/auth/me", 200, { headers: { cookie } });
}

console.log(`smoke passed: ${baseUrl}${email ? " (authenticated)" : " (public + auth boundary)"}`);
