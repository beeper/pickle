export class MatrixREST {
  constructor(account) {
    this.account = account;
  }

  async request(method, path, body) {
    let lastError;
    const homeserverUrl = this.account.homeserverUrl ?? this.account.homeserver;
    if (!homeserverUrl) {
      throw new Error("MatrixREST account is missing homeserverUrl");
    }
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await fetch(new URL(path, homeserverUrl), {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          authorization: `Bearer ${this.account.accessToken}`,
          "content-type": "application/json",
        },
        method,
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (response.ok) {
        return data;
      }
      lastError = new Error(`${method} ${path} failed: HTTP ${response.status} ${JSON.stringify(data)}`);
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === 5) {
        throw lastError;
      }
      const retryAfterMs = Number(data.retry_after_ms) || attempt * 1500;
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    }
    throw lastError;
  }

  createRoom({ historyVisibility, initialState = [], invite = [], name, topic } = {}) {
    const state = [...initialState];
    if (historyVisibility) {
      state.push({
        content: { history_visibility: historyVisibility },
        state_key: "",
        type: "m.room.history_visibility",
      });
    }
    return this.request("POST", "/_matrix/client/v3/createRoom", {
      invite,
      initial_state: state,
      is_direct: false,
      name,
      preset: "private_chat",
      topic,
    });
  }

  createEncryptedRoom({ historyVisibility, invite = [], name, topic } = {}) {
    const initialState = [
      {
        content: {
          algorithm: "m.megolm.v1.aes-sha2",
          rotation_period_ms: 604800000,
          rotation_period_msgs: 100,
        },
        state_key: "",
        type: "m.room.encryption",
      },
    ];
    return this.createRoom({
      historyVisibility,
      invite,
      initialState,
      name,
      topic,
    });
  }

  invite(roomId, userId) {
    return this.request("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
      user_id: userId,
    });
  }

  join(roomIdOrAlias) {
    return this.request(
      "POST",
      `/_matrix/client/v3/join/${encodeURIComponent(roomIdOrAlias)}`,
      {}
    );
  }

  sync({ since, timeout = 0 } = {}) {
    const params = new URLSearchParams({ timeout: String(timeout), set_presence: "offline" });
    if (since) {
      params.set("since", since);
    }
    return this.request("GET", `/_matrix/client/v3/sync?${params.toString()}`);
  }
}
