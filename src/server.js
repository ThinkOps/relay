const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { createMistri } = require("./domain");

const WEB_ROOT = path.join(__dirname, "..", "web");
const STATIC_FILES = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};

async function startServer({ dbPath, cwd = process.cwd(), host = "127.0.0.1", port = 4173 }) {
  const token = crypto.randomBytes(24).toString("hex");
  const server = http.createServer((request, response) => {
    handleRequest({ request, response, dbPath, cwd, token }).catch((error) => {
      sendJson(response, 500, { error: error.message });
    });
  });

  const selectedPort = await listen(server, host, Number(port));
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    server,
    token,
    url: `http://${host}:${selectedPort}`,
  };
}

async function handleRequest({ request, response, dbPath, cwd, token }) {
  setSecurityHeaders(response);
  const url = new URL(request.url, "http://localhost");

  if (request.method === "GET" && url.pathname === "/config.js") {
    send(response, 200, `window.MISTRI_CONFIG = ${JSON.stringify({ token })};\n`, "text/javascript; charset=utf-8");
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApi({ request, response, url, dbPath, cwd, token });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const staticFile = STATIC_FILES[url.pathname];
  if (!staticFile) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  const body = await fs.readFile(path.join(WEB_ROOT, staticFile.file));
  send(response, 200, body, staticFile.type);
}

async function handleApi({ request, response, url, dbPath, cwd, token }) {
  if (request.method !== "GET" && request.headers["x-mistri-token"] !== token) {
    sendJson(response, 403, { error: "Invalid request token." });
    return;
  }

  const app = createMistri({ dbPath, cwd });
  try {
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "GET" && url.pathname === "/api/board") {
      sendJson(response, 200, app.board());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/projects") {
      sendJson(response, 200, app.listProjects());
      return;
    }

    if (request.method === "GET" && parts[1] === "cards" && parts[2]) {
      sendJson(response, 200, app.getCard(parts[2]));
      return;
    }

    if (request.method === "POST" && parts[1] === "cards" && parts[3] === "submit") {
      const body = await readBody(request);
      sendJson(response, 200, app.submitCard(parts[2], body));
      return;
    }

    if (request.method === "POST" && parts[1] === "admin" && parts[2] && parts[3]) {
      const body = await readBody(request);
      const input = { ...body, role: "admin" };
      const actions = {
        approve: () => app.approveCard(parts[3], input),
        changes: () => app.requestChanges(parts[3], input),
        reject: () => app.rejectCard(parts[3], input),
        pause: () => app.pauseCard(parts[3], input),
        cancel: () => app.cancelCard(parts[3], input),
        done: () => app.completeCard(parts[3], input),
      };

      const action = actions[parts[2]];
      if (!action) {
        sendJson(response, 404, { error: "Unknown admin action." });
        return;
      }
      sendJson(response, 200, action());
      return;
    }

    if (request.method === "POST" && parts[1] === "claim" && parts[2]) {
      const body = await readBody(request);
      sendJson(response, 200, app.claimCard(parts[2], body));
      return;
    }

    if (request.method === "POST" && parts[1] === "move" && parts[2]) {
      const body = await readBody(request);
      sendJson(response, 200, app.moveCard(parts[2], body));
      return;
    }

    if (request.method === "POST" && parts[1] === "note" && parts[2]) {
      const body = await readBody(request);
      sendJson(response, 200, app.addNote(parts[2], body));
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  } finally {
    app.close();
  }
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const tryPort = (candidate) => {
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE") {
          tryPort(candidate + 1);
          return;
        }
        reject(error);
      });

      server.listen(candidate, host, () => {
        server.removeAllListeners("error");
        resolve(server.address().port);
      });
    };

    tryPort(port);
  });
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function send(response, status, body, contentType) {
  response.writeHead(status, { "Content-Type": contentType });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

module.exports = {
  startServer,
};
