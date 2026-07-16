// === КОНФИГУРАЦИЯ SUPABASE ===
const SUPABASE_URL = 'https://lcxbcxagitcilklmniwe.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_lhqj8KIXDVvXTvcTuHTMzw_G6JytrCL';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let userApiKeys = [];
let currentPersona = null;

// Оставляем только модели 1.5, так как 1.0 не поддерживает system_instruction
const GEMINI_MODELS = [
    'gemini-1.5-pro',
    'gemini-1.5-flash'
];

// === СЛУШАТЕЛЬ СЕССИИ ===
supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session) {
        currentUser = session.user;
        document.getElementById('auth-screen').classList.add('hidden');
        await checkApiKeys();
    } else {
        currentUser = null;
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
});

// Авторизация
document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) alert("Ошибка входа: " + error.message);
});

document.getElementById('btn-register').addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if (error) alert("Ошибка регистрации: " + error.message);
    else alert("Регистрация успешна!");
});

document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
});

// === ЛОГИКА API КЛЮЧЕЙ ===
async function checkApiKeys() {
    const { data, error } = await supabaseClient.from('api_keys').select('key_value');
    
    if (data && data.length > 0) {
        userApiKeys = data.map(k => k.key_value);
        document.getElementById('api-key-modal').classList.add('hidden');
        startApp();
    } else {
        document.getElementById('api-key-modal').classList.remove('hidden');
    }
}

document.getElementById('btn-add-key').addEventListener('click', async () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key.startsWith('AIzaSy')) {
        alert("Неверный формат ключа! Ключ Gemini должен начинаться с AIzaSy...");
        return;
    }
    
    if (userApiKeys.length >= 5) {
        alert("Максимум 5 ключей!");
        return;
    }
    
    const { error } = await supabaseClient.from('api_keys').insert([{ user_id: currentUser.id, key_value: key }]);
    
    if (error) alert("Ошибка добавления: " + error.message);
    else {
        userApiKeys.push(key);
        document.getElementById('keys-list').innerHTML += `<li>Ключ добавлен (всего: ${userApiKeys.length})</li>`;
        document.getElementById('api-key-input').value = '';
        document.getElementById('btn-finish-keys').classList.remove('hidden');
    }
});

document.getElementById('btn-finish-keys').addEventListener('click', () => {
    document.getElementById('api-key-modal').classList.add('hidden');
    startApp();
});

// === ЗАПУСК ПРИЛОЖЕНИЯ И ЗАГРУЗКА ИИ ===
async function startApp() {
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('chat-input-area').classList.add('hidden'); // Скрываем поле ввода
    document.getElementById('chat-header').innerText = `Выберите ИИ для начала общения`;
    document.getElementById('chat-messages').innerHTML = '';
    currentPersona = null;
    
    await loadPersonas();
}

async function loadPersonas() {
    const { data, error } = await supabaseClient.from('ai_personas').select('*');
    const list = document.getElementById('ai-list');
    list.innerHTML = '';
    
    if (data) {
        data.forEach(persona => {
            const li = document.createElement('li');
            li.className = 'ai-item';
            li.innerText = persona.name;
            li.onclick = () => selectPersona(persona);
            list.appendChild(li);
        });
    }
}

function selectPersona(persona) {
    currentPersona = persona;
    document.getElementById('chat-header').innerText = `Чат: ${persona.name}`;
    document.getElementById('chat-messages').innerHTML = ''; 
    document.getElementById('chat-input-area').classList.remove('hidden');
}

// === СОЗДАНИЕ НОВОГО ИИ ===
document.getElementById('btn-new-ai').addEventListener('click', () => {
    document.getElementById('new-ai-modal').classList.remove('hidden');
});

document.getElementById('btn-close-ai').addEventListener('click', () => {
    document.getElementById('new-ai-modal').classList.add('hidden');
});

document.getElementById('btn-save-ai').addEventListener('click', async () => {
    const name = document.getElementById('ai-name').value.trim();
    const prompt = document.getElementById('ai-prompt').value.trim();
    
    if (!name || !prompt) {
        alert("Заполните имя и промпт!");
        return;
    }
    
    const { error } = await supabaseClient.from('ai_personas').insert([{
        user_id: currentUser.id,
        name: name,
        system_prompt: prompt
    }]);
    
    if (error) alert(error.message);
    else {
        document.getElementById('new-ai-modal').classList.add('hidden');
        document.getElementById('ai-name').value = '';
        document.getElementById('ai-prompt').value = '';
        await loadPersonas();
    }
});

// === РОУТИНГ КЛЮЧЕЙ GEMINI ===
async function sendGeminiRequest(promptText) {
    for (let model of GEMINI_MODELS) {
        for (let apiKey of userApiKeys) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        system_instruction: { parts: [{ text: currentPersona.system_prompt }]},
                        contents: [{ parts: [{ text: promptText }]}]
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    if (response.status === 429 || data.error?.code === 429) {
                        console.warn(`Модель ${model} или ключ исчерпали лимит. Переключаемся...`);
                        continue; 
                    }
                    throw new Error(data.error?.message || 'Ошибка API');
                }

                return data.candidates[0].content.parts[0].text;

            } catch (error) {
                console.error("Попытка неудачна:", error);
            }
        }
    }
    throw new Error("Все ваши API ключи или лимиты моделей Gemini полностью исчерпаны.");
}

// === ОТПРАВКА СООБЩЕНИЙ ===
document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !currentPersona) return;

    const chatBox = document.getElementById('chat-messages');
    chatBox.innerHTML += `<div class="msg user">${text}</div>`;
    input.value = '';
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        const reply = await sendGeminiRequest(text);
        chatBox.innerHTML += `<div class="msg model">${reply}</div>`;
        chatBox.scrollTop = chatBox.scrollHeight;
    } catch (error) {
        alert(error.message);
        if (chatBox.lastElementChild) {
            chatBox.lastElementChild.remove(); 
        }
    }
});