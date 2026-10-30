/* Сервис входа в админку (Cloudflare Worker).
 *
 * Decap CMS сам не умеет авторизоваться в GitHub с GitHub Pages: нужен посредник,
 * который держит секрет приложения и обменивает одноразовый код на токен.
 *
 * Маршруты:
 *   /auth      — отправляет на страницу входа GitHub
 *   /callback  — GitHub возвращает сюда с кодом; меняем его на токен и отдаём админке
 *
 * Переменные окружения (Cloudflare → Worker → Settings → Variables and Secrets):
 *   GITHUB_CLIENT_ID      — Client ID OAuth-приложения
 *   GITHUB_CLIENT_SECRET  — Client secret (тип Secret)
 *   ALLOWED_ORIGIN        — https://halalbeauty.github.io (куда разрешено отдать токен)
 *
 * Сам по себе вход ничего не даёт: сохранить правки сможет только тот, у кого
 * есть доступ на запись в репозиторий.
 */

const SCOPE = "repo";

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function page(origin, message, ok) {
  // Страница-посредник для Decap: сообщает окну админки результат входа.
  const payload = ok
    ? "authorization:github:success:" + JSON.stringify({ token: message, provider: "github" })
    : "authorization:github:error:" + JSON.stringify({ message });
  const html = `<!doctype html><meta charset="utf-8"><title>Вход</title>
<script>
(function () {
  var origin = ${JSON.stringify(origin)};
  var payload = ${JSON.stringify(payload)};
  function onMessage(e) {
    if (e.origin !== origin) return;
    window.opener.postMessage(payload, origin);
    window.removeEventListener("message", onMessage, false);
    window.close();
  }
  window.addEventListener("message", onMessage, false);
  window.opener.postMessage("authorizing:github", origin);
})();
</script>
<p>${ok ? "Вход выполнен, окно закроется." : "Не удалось войти."}</p>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": "oauth_state=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth") {
      const state = randomState();
      const target = new URL("https://github.com/login/oauth/authorize");
      target.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      target.searchParams.set("redirect_uri", url.origin + "/callback");
      target.searchParams.set("scope", SCOPE);
      target.searchParams.set("state", state);
      return new Response(null, {
        status: 302,
        headers: {
          Location: target.toString(),
          "Set-Cookie": `oauth_state=${state}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`,
        },
      });
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state || state !== getCookie(request, "oauth_state")) {
        return page(env.ALLOWED_ORIGIN, "Неверный или просроченный запрос входа", false);
      }
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: url.origin + "/callback",
        }),
      });
      const data = await res.json();
      if (!data.access_token) {
        return page(env.ALLOWED_ORIGIN, data.error_description || "GitHub не выдал токен", false);
      }
      return page(env.ALLOWED_ORIGIN, data.access_token, true);
    }

    return new Response("Halal Beauty — сервис входа в админку", { status: 200 });
  },
};
