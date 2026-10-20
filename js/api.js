/* Staff API client. The session cookie is HttpOnly; this file only remembers the CSRF token. */
(() => {
  const api = {
    csrf: "",

    async send(method, path, body) {
      const headers = {};
      const upper = method.toUpperCase();
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (upper !== "GET" && upper !== "HEAD") headers["X-CSRF-Token"] = api.csrf || "";
      const res = await fetch(path, {
        method: upper,
        credentials: "same-origin",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.csrf) api.csrf = data.csrf;
      if (!res.ok) {
        const err = new Error(data.error || "The server could not do that.");
        err.status = res.status;
        throw err;
      }
      return data;
    },

    async bootstrap() {
      return api.send("GET", "/api/bootstrap");
    },
  };

  window.BJJ_API = api;
})();
