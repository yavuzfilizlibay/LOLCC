/* LOLCC Chat WebView v0.2 — agent mode + tool status UI */
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const cancelBtn = document.getElementById("cancelBtn");
const clearBtn = document.getElementById("clearBtn");
const modeSelect = document.getElementById("modeSelect");
const autoApproveEl = document.getElementById("autoApprove");

let currentAssistantBubble = null;
let currentReasoningBubble = null;
let isStreaming = false;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderMarkdown(text) {
  text = text.replace(/```([a-z]*)\n([\s\S]*?)```/gi, (_, lang, code) =>
    `<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`
  );
  text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
  return text;
}

function addBubble(cls, content, label) {
  const div = document.createElement("div");
  div.className = `bubble ${cls}`;
  if (label) {
    const lbl = document.createElement("div");
    lbl.className = "label";
    lbl.textContent = label;
    div.appendChild(lbl);
  }
  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = renderMarkdown(content);
  div.appendChild(body);
  messagesEl.appendChild(div);
  scrollToBottom();
  return body;
}

function addToolBubble(toolName, params) {
  const div = document.createElement("div");
  div.className = "bubble tool-call";
  const header = document.createElement("div");
  header.className = "tool-header";
  header.innerHTML = `<span class="tool-icon">🔧</span><span class="tool-name">${escapeHtml(toolName)}</span><span class="tool-status">çalışıyor...</span>`;
  div.appendChild(header);
  const body = document.createElement("div");
  body.className = "tool-body";
  const summary = formatToolSummary(toolName, params);
  body.innerHTML = `<pre><code>${escapeHtml(summary)}</code></pre>`;
  div.appendChild(body);
  messagesEl.appendChild(div);
  scrollToBottom();
  return { wrapper: div, header, body };
}

function formatToolSummary(name, params) {
  if (name === "read_file") return `📖 ${params.path || "?"}`;
  if (name === "write_to_file") return `✏️ ${params.path || "?"}\n${(params.content || "").slice(0, 200)}${(params.content || "").length > 200 ? "..." : ""}`;
  if (name === "execute_command") return `▶ ${params.command || "?"}`;
  if (name === "list_files") return `📁 ${params.path || "."}`;
  if (name === "ask_followup_question") return `❓ ${params.question || ""}`;
  return JSON.stringify(params, null, 2);
}

function scrollToBottom() {
  requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
}

function sendMessage() {
  if (isStreaming) return;
  const text = inputEl.value.trim();
  if (!text) return;
  vscode.postMessage({ type: "userMessage", content: text });
  addBubble("user", text);
  inputEl.value = "";
  isStreaming = true;
  sendBtn.disabled = true;
  cancelBtn.style.display = "inline-block";
}

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
sendBtn.addEventListener("click", sendMessage);
cancelBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "cancel" });
  cancelBtn.disabled = true;
});
clearBtn.addEventListener("click", () => {
  if (confirm("Konuşmayı temizle?")) vscode.postMessage({ type: "clear" });
});
modeSelect.addEventListener("change", () => {
  vscode.postMessage({ type: "setMode", mode: modeSelect.value });
});
autoApproveEl.addEventListener("change", () => {
  vscode.postMessage({ type: "setAutoApprove", value: autoApproveEl.checked });
});

let currentToolUi = null;

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "userBubble":
      addBubble("user", msg.content, msg.label);
      isStreaming = true;
      sendBtn.disabled = true;
      cancelBtn.style.display = "inline-block";
      break;
    case "iteration":
      addBubble("info", `Iterasyon ${msg.n}/${msg.max}`);
      break;
    case "assistantStart": {
      const div = document.createElement("div");
      div.className = "bubble assistant streaming";
      const body = document.createElement("div");
      body.className = "body";
      div.appendChild(body);
      messagesEl.appendChild(div);
      currentAssistantBubble = body;
      currentAssistantBubble._raw = "";
      currentAssistantBubble._wrapper = div;
      scrollToBottom();
      break;
    }
    case "assistantToken":
      if (currentAssistantBubble) {
        currentAssistantBubble._raw += msg.text;
        currentAssistantBubble.innerHTML = renderMarkdown(currentAssistantBubble._raw);
        scrollToBottom();
      }
      break;
    case "reasoningToken":
      if (currentAssistantBubble) {
        if (!currentReasoningBubble) {
          const div = document.createElement("div");
          div.className = "reasoning";
          const lbl = document.createElement("div");
          lbl.className = "label";
          lbl.textContent = "Düşünüyor...";
          const body = document.createElement("div");
          body.className = "body";
          div.appendChild(lbl);
          div.appendChild(body);
          currentAssistantBubble._wrapper.parentNode.insertBefore(div, currentAssistantBubble._wrapper);
          currentReasoningBubble = body;
          currentReasoningBubble._raw = "";
        }
        currentReasoningBubble._raw += msg.text;
        currentReasoningBubble.textContent = currentReasoningBubble._raw;
      }
      break;
    case "assistantEnd":
      if (currentAssistantBubble) currentAssistantBubble._wrapper.classList.remove("streaming");
      currentAssistantBubble = null;
      currentReasoningBubble = null;
      break;
    case "toolStart":
      currentToolUi = addToolBubble(msg.tool, msg.params);
      break;
    case "toolResult": {
      if (currentToolUi) {
        currentToolUi.header.querySelector(".tool-status").textContent = msg.result.ok ? "✅ tamam" : "❌ hata";
        currentToolUi.wrapper.classList.add(msg.result.ok ? "tool-ok" : "tool-err");
        const out = msg.result.ok ? msg.result.data : msg.result.error;
        if (out) {
          const outDiv = document.createElement("div");
          outDiv.className = "tool-output";
          outDiv.innerHTML = `<pre><code>${escapeHtml((out + "").slice(0, 1500))}</code></pre>`;
          currentToolUi.wrapper.appendChild(outDiv);
        }
        currentToolUi = null;
      }
      break;
    }
    case "completion":
      addBubble("completion", "✅ " + msg.text, "Tamamlandı");
      isStreaming = false;
      sendBtn.disabled = false;
      cancelBtn.style.display = "none";
      cancelBtn.disabled = false;
      inputEl.focus();
      break;
    case "error":
      addBubble("error", "Hata: " + msg.text);
      isStreaming = false;
      sendBtn.disabled = false;
      cancelBtn.style.display = "none";
      cancelBtn.disabled = false;
      currentAssistantBubble = null;
      currentReasoningBubble = null;
      break;
    case "info":
      addBubble("info", msg.text);
      break;
    case "cleared":
      messagesEl.innerHTML = "";
      addBubble("info", "Konuşma temizlendi.");
      isStreaming = false;
      sendBtn.disabled = false;
      cancelBtn.style.display = "none";
      break;
  }
});

inputEl.focus();
