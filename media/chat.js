/* LOLCC Chat WebView — vanilla JS, no dependencies */
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");

let currentAssistantBubble = null;
let currentReasoningBubble = null;
let isStreaming = false;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Crude markdown rendering — code fences only
function renderMarkdown(text) {
  // Triple backtick blocks
  text = text.replace(/```([a-z]*)\n([\s\S]*?)```/gi, (_, lang, code) => {
    return `<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`;
  });
  // Inline `code`
  text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
  // Convert plain newlines that aren't already in <pre>
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

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
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
}

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
sendBtn.addEventListener("click", sendMessage);
clearBtn.addEventListener("click", () => {
  if (confirm("Konuşmayı temizle?")) vscode.postMessage({ type: "clear" });
});

// Receive messages from extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "userBubble":
      addBubble("user", msg.content, msg.label);
      isStreaming = true;
      sendBtn.disabled = true;
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
          currentAssistantBubble._wrapper.parentNode.insertBefore(
            div,
            currentAssistantBubble._wrapper
          );
          currentReasoningBubble = body;
          currentReasoningBubble._raw = "";
        }
        currentReasoningBubble._raw += msg.text;
        currentReasoningBubble.textContent = currentReasoningBubble._raw;
      }
      break;
    case "assistantEnd":
      if (currentAssistantBubble) {
        currentAssistantBubble._wrapper.classList.remove("streaming");
      }
      currentAssistantBubble = null;
      currentReasoningBubble = null;
      isStreaming = false;
      sendBtn.disabled = false;
      inputEl.focus();
      break;
    case "error":
      addBubble("error", "Hata: " + msg.text);
      currentAssistantBubble = null;
      currentReasoningBubble = null;
      isStreaming = false;
      sendBtn.disabled = false;
      break;
    case "info":
      addBubble("info", msg.text);
      break;
    case "cleared":
      messagesEl.innerHTML = "";
      addBubble("info", "Konuşma temizlendi.");
      break;
  }
});

// initial focus
inputEl.focus();
