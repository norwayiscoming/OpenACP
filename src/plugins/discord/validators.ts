export async function validateDiscordToken(token: string): Promise<
  | { ok: true; username: string; id: string }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.status === 200) {
      const data = (await res.json()) as { username: string; id: string };
      return { ok: true, username: data.username, id: data.id };
    }
    if (res.status === 401) {
      return { ok: false, error: "Token rejected by Discord (401 Unauthorized)" };
    }
    return { ok: false, error: `Discord API returned ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
