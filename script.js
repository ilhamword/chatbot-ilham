// ===================== EplinBot Modern AI =====================
// UI, Chat logic (Gemini text), and Image generation intent
// =============================================================

// ============ DOM refs ============
let starsAnimationId = null; // for cancelling the stars animation
const chatBody = document.querySelector(".chat-body");
const messageInput = document.querySelector(".message-input");
const sendMessageButton = document.querySelector("#send-message");
const fileInput = document.querySelector("#file-input");
const fileUploadWrapper = document.querySelector(".file-upload-wrapper");
const fileCancelButton = document.querySelector("#file-cancel");
const chatbotToggler = document.querySelector("#chatbot-toggler");
const closeChatbot = document.querySelector("#close-chatbot");
const themeToggle = document.querySelector("#theme-toggle");
const chatPopup = document.querySelector(".chatbot-popup");

// ============ API CONFIGS ============
// Gemini Multi-Key Pool (rotasi 4 key otomatis untuk mencegah limit/habis kuota)
const GEMINI_API_KEYS = [
  atob("QVEuQWI4Uk42SkhzWE82NkpLWlNDaFVuNzByUWZ3YzhKQnVhSUNkWFUwVEhVc3pGOTBzbFE="),
  atob("QVEuQWI4Uk42SUl4aVBZU1E3WHNOWGpWZGgtX1kzTjdzM1pURFVIaXo4OHJsRFFRTnJ2TVE="),
  atob("QVEuQWI4Uk42S181ZWRMNTY5QkhXaERCSURiTy1HYmZWSkppMzFTVzN6QWliTU1nSUdPWkE="),
  atob("QVEuQWI4Uk42TFJRVGQzbGhOZ1g2eE5BeEpnVzV6bi0xRFFPSjdoNXFHc0pud0F0MmM5NVE=")
];
let currentKeyIndex = 0;
const GEMINI_MODEL = "gemini-flash-latest";
const getGeminiUrl = (key) => `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// Image provider (no key by default). You can switch to "openai" or "stability" if you have keys.
const IMG_PROVIDER = "pollinations"; // "pollinations" | "openai" | "stability"
const OPENAI_API_KEY = ""; // optional
const STABILITY_API_KEY = ""; // optional

// User session data
const userData = { message: null, file: { data: null, mime_type: null } };
const chatHistory = [];
const initialInputHeight = messageInput.scrollHeight;
let isSending = false;

// ============ Utilities ============
const createMessageElement = (content, ...classes) => {
  const div = document.createElement("div");
  div.classList.add("message", ...classes);
  div.innerHTML = content;
  return div;
};

function scrollToBottom() {
  chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: "smooth" });
}

function mdToHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") // escape
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>")
    .replace(/^\*\s(.*)$/gm, "• $1")
    .replace(/\n{2,}/g, "<br><br>")
    .replace(/\n/g, "<br>");
}

// ============ Stars BG ============
function initStarsCanvas() {
  let canvas = document.getElementById("starsCanvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "starsCanvas";
    document.body.appendChild(canvas);
  }
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const stars = Array.from({ length: 100 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    radius: Math.random() * 1.5,
    speed: Math.random() * 0.5 + 0.2,
  }));

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach((s) => {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      s.y += s.speed;
      if (s.y > canvas.height) s.y = 0;
    });
    starsAnimationId = requestAnimationFrame(animate);
  }
  animate();
}

function destroyStarsCanvas() {
  cancelAnimationFrame(starsAnimationId);
  const canvas = document.getElementById("starsCanvas");
  if (canvas) canvas.remove();
}

// ============ Dark mode ============
function setDarkMode(active) {
  if (active) {
    document.body.classList.add("dark-mode");
    initStarsCanvas();
  } else {
    document.body.classList.remove("dark-mode");
    destroyStarsCanvas();
  }
}
(function autoSetDarkModeByTime() {
  const hour = new Date().getHours();
  const isNight = hour >= 18 || hour < 6;
  setDarkMode(isNight);
})();

themeToggle?.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark-mode");
  if (isDark) initStarsCanvas(); else destroyStarsCanvas();
});

// ============ Emoji picker ============
const picker = new EmojiMart.Picker({
  onEmojiSelect: (e) => {
    messageInput.value += e.native;
    messageInput.dispatchEvent(new Event("input"));
  },
  theme: "dark"
});
document.body.appendChild(picker);
document.getElementById("emoji-picker")?.addEventListener("click", () => {
  document.body.classList.toggle("show-emoji-picker");
});

// ============ Drag & Drop ============
["dragenter", "dragover"].forEach(evt => {
  chatPopup.addEventListener(evt, (e) => { e.preventDefault(); chatPopup.classList.add("dragover"); });
});
["dragleave", "drop"].forEach(evt => {
  chatPopup.addEventListener(evt, (e) => { e.preventDefault(); chatPopup.classList.remove("dragover"); });
});
chatPopup.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files?.[0];
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    fileUploadWrapper.querySelector("img").src = ev.target.result;
    fileUploadWrapper.classList.add("file-uploaded");
    const base64String = ev.target.result.split(",")[1];
    userData.file = { data: base64String, mime_type: file.type };
  };
  reader.readAsDataURL(file);
});

// ============ Gemini Text API ============
async function generateBotText(incomingMessageDiv) {
  const MessageElement = incomingMessageDiv.querySelector(".message-text");
  const parts = [{ text: userData.message }];
  if (userData.file.data) parts.push({ inline_data: userData.file });

  chatHistory.push({
    role: "user",
    parts
  });

  const requestBody = {
    contents: chatHistory,
    systemInstruction: {
      role: "system",
      parts: [{
        text: `Kamu adalah EplinBot, asisten AI pribadi yang super kocak, tengil, ceplas-ceplos, dan punya selera humor receh tapi cerdas khusus buat nemenin Eplin (Evlyn).

Karakter & Gaya Bicara:
1. JANGAN PERNAH KAKU atau formal kayak robot customer service! Hindari jawaban klise, kaku, atau sok bijak.
2. Gunakan gaya bahasa tongkrongan/gaul, santai, ekspresif, banyak banyolan, roasting canda yang lucu, dan kadang agak nyolot/tengil tapi gemesin dan seru.
3. Kalau Eplin nanya pertanyaan aneh, lebay, atau cuma nyapa singkat ('p', 'hi', dll), ledek atau roasting balik dengan sindiran lucu/tengil dulu sebelum dijawab.
4. Kamu fasih bahasa gaul, Sunda (misal: "atuh", "kumaha", "euy", "teh", "naha"), dan Inggris santai.
5. Panggil user dengan "Eplin" atau "Plin" (sesekali Evlyn). Nama kamu EplinBot.
6. Tetap jawab inti pertanyaannya dengan benar dan cerdas, tapi bungkus selalu dengan humor, roasting kocak, dan celetukan yang bikin Eplin ngakak.`
      }]
    },
    generationConfig: {
      temperature: 1.15,
      topP: 0.95
    }
  };

  let lastError = null;
  let success = false;

  for (let attempt = 0; attempt < GEMINI_API_KEYS.length; attempt++) {
    const key = GEMINI_API_KEYS[currentKeyIndex];
    const url = getGeminiUrl(key);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || `HTTP error ${response.status}`);
      }

      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "🤖 ...";
      const html = mdToHtml(raw.trim());
      MessageElement.innerHTML = html;
      chatHistory.push({ role: "model", parts: [{ text: raw }] });

      // Putar ke key berikutnya untuk giliran selanjutnya (round-robin)
      currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
      success = true;
      break;
    } catch (err) {
      console.warn(`Key #${currentKeyIndex + 1} mengalami kendala (${err.message}). Beralih ke key berikutnya...`);
      lastError = err;
      // Ganti ke key selanjutnya
      currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
    }
  }

  if (!success) {
    MessageElement.textContent = lastError?.message || "Semua kuota API sedang habis atau terjadi kendala koneksi.";
    MessageElement.style.color = "#ff6b6b";
  }

  userData.file = {};
  incomingMessageDiv.classList.remove("thinking");
  scrollToBottom();
}

// ============ Image Generation Intent ============
function detectImageIntent(text) {
  if (!text) return { isImage: false, prompt: "" };
  const r = /^(buat(kan)?|generate|gambar|kirim gambar|lukis|ilustrasi|create|draw)\b(.+)?/i;
  const m = text.match(r);
  if (!m) return { isImage: false, prompt: "" };
  // extract prompt after the verb if present
  const p = text.replace(r, "").trim() || text;
  return { isImage: true, prompt: p };
}

async function generateImageURL(prompt) {
  // Default: Pollinations (no key, CDN-like, public)
  if (IMG_PROVIDER === "pollinations") {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?n=1&size=1024x1024&model=flux`;
    return url;
  }
  // OpenAI images
  if (IMG_PROVIDER === "openai" && OPENAI_API_KEY) {
    try {
      const resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({ prompt, size: "1024x1024", model: "gpt-image-1" })
      });
      const data = await resp.json();
      const b64 = data?.data?.[0]?.b64_json;
      if (b64) return `data:image/png;base64,${b64}`;
    } catch {}
  }
  // Stability
  if (IMG_PROVIDER === "stability" && STABILITY_API_KEY) {
    try {
      const resp = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${STABILITY_API_KEY}`,
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt,
          output_format: "png",
          width: 1024, height: 1024
        })
      });
      const data = await resp.json();
      const img = data?.image;
      if (img) return `data:image/png;base64,${img}`;
    } catch {}
  }
  // Fallback placeholder
  return `https://picsum.photos/seed/${encodeURIComponent(prompt)}/1024/1024`;
}

async function sendImageResponse(incomingMessageDiv, prompt) {
  const MessageElement = incomingMessageDiv.querySelector(".message-text");
  try {
    const url = await generateImageURL(prompt);
    MessageElement.innerHTML = mdToHtml(`Siap! Ini gambarnya untuk: **${prompt || "permintaanmu"}**`);
    const img = document.createElement("img");
    img.className = "bot-image";
    img.alt = prompt || "generated image";
    img.src = url;
    incomingMessageDiv.appendChild(img);
  } catch (e) {
    MessageElement.textContent = "Maaf, gagal membuat gambar 😭";
  } finally {
    incomingMessageDiv.classList.remove("thinking");
    scrollToBottom();
  }
}

// ============ Sending flow ============
function buildIncomingThinking() {
  const content = `
<svg class="bot-avatar" xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 1024 1024"><path d="M738.3 287.6H285.7c-59 0-106.8 47.8-106.8 106.8v303.1c0 59 47.8 106.8 106.8 106.8h81.5v111.1c0 .7.8 1.1 1.4.7l166.9-110.6 41.8-.8h117.4l43.6-.4c59 0 106.8-47.8 106.8-106.8V394.5c0-59-47.8-106.9-106.8-106.9zM351.7 448.2c0-29.5 23.9-53.5 53.5-53.5s53.5 23.9 53.5 53.5-23.9 53.5-53.5 53.5-53.5-23.9-53.5-53.5zm157.9 267.1c-67.8 0-123.8-47.5-132.3-109h264.6c-8.6 61.5-64.5 109-132.3 109zm110-213.7c-29.5 0-53.5-23.9-53.5-53.5s23.9-53.5 53.5-53.5 53.5 23.9 53.5 53.5-23.9 53.5-53.5 53.5zM867.2 644.5V453.1h26.5c19.4 0 35.1 15.7 35.1 35.1v121.1c0 19.4-15.7 35.1-35.1 35.1h-26.5zM95.2 609.4V488.2c0-19.4 15.7-35.1 35.1-35.1h26.5v191.3h-26.5c-19.4 0-35.1-15.7-35.1-35.1zM561.5 149.6c0 23.4-15.6 43.3-36.9 49.7v44.9h-30v-44.9c-21.4-6.5-36.9-26.3-36.9-49.7 0-28.6 23.3-51.9 51.9-51.9s51.9 23.3 51.9 51.9z"></path></svg>
<div class="message-text"><div class="thinking-indicator">
  <div class="dot"></div><div class="dot"></div><div class="dot"></div>
</div></div>`;
  const div = createMessageElement(content, "bot-message", "thinking");
  chatBody.appendChild(div);
  scrollToBottom();
  return div;
}

function handleOutgoingMessage(e) {
  e.preventDefault();
  if (isSending) return;
  userData.message = messageInput.value.trim();
  if (!userData.message) return;

  // UI reset
  isSending = true;
  messageInput.value = "";
  fileUploadWrapper.classList.remove("file-uploaded");
  messageInput.dispatchEvent(new Event("input"));

  // Append user bubble
  const messageContent = `<div class="message-text"></div>
    ${userData.file.data ? `<img src="data:${userData.file.mime_type};base64,${userData.file.data}" class="attachment" alt="lampiran pengguna" />` : ""}`;

  const outgoingMessageDiv = createMessageElement(messageContent, "user-message");
  outgoingMessageDiv.querySelector(".message-text").textContent = userData.message;
  chatBody.appendChild(outgoingMessageDiv);
  scrollToBottom();

  // Route: image or text
  const { isImage, prompt } = detectImageIntent(userData.message);
  const incoming = buildIncomingThinking();
  if (isImage) {
    sendImageResponse(incoming, prompt);
    isSending = false;
    userData.file = {};
    return;
  }
  generateBotText(incoming).finally(() => { isSending = false; });
}

// Resize textarea
messageInput.addEventListener("input", () => {
  messageInput.style.height = `${initialInputHeight}px`;
  messageInput.style.height = `${messageInput.scrollHeight}px`;
  document.querySelector(".chat-form").style.borderRadius = messageInput.scrollHeight > initialInputHeight ? "15px" : "18px";
});

// Keyboard send (desktop)
messageInput.addEventListener("keydown", (e) => {
  const text = e.target.value.trim();
  if (e.key === "Enter" && text && !e.shiftKey && window.innerWidth > 768) {
    handleOutgoingMessage(e);
  }
});

// File upload
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    fileUploadWrapper.querySelector("img").src = e.target.result;
    fileUploadWrapper.classList.add("file-uploaded");
    const base64String = e.target.result.split(",")[1];
    userData.file = { data: base64String, mime_type: file.type };
    fileInput.value = "";
  };
  reader.readAsDataURL(file);
});
fileCancelButton.addEventListener("click", () => {
  userData.file = {};
  fileUploadWrapper.classList.remove("file-uploaded");
});
document.querySelector("#file-upload").addEventListener("click", () => fileInput.click());

// Send
sendMessageButton.addEventListener("click", (e) => handleOutgoingMessage(e));

// Panel toggles
chatbotToggler.addEventListener("click", () => document.body.classList.toggle("show-chatbot"));
closeChatbot.addEventListener("click", () => document.body.classList.remove("show-chatbot"));