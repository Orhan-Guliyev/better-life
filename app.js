// === КОНФИГУРАЦИЯ SUPABASE ===
const SUPABASE_URL = 'https://lcxbcxagitcilklmniwe.supabase.co'; // Твой URL из логов
const SUPABASE_ANON_KEY = 'ТВОЙ_SUPABASE_ANON_KEY'; // Сюда вставь свой anon key

// Инициализация клиента
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let userApiKeys = [];
let currentPersona = null;

const GEMINI_MODELS = [
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash-latest',
    'gemini-1.0-pro'
];

// === СЛУШАТЕЛЬ СЕССИИ (Supabase Auth) ===
supabase.auth.onAuthStateChange(async (event, session) => {
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

// Вход
document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert("Ошибка входа: " + error.message);
});

// Регистрация
document.getElementById('btn-register').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) alert("Ошибка регистрации: " + error.message);
    else alert("Регистрация успешна! Проверьте почту для подтверждения (если включено в Supabase) или попробуйте войти.");
});

// Выход
document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
});

// === ЛОГИКА API КЛЮЧЕЙ ===
async function checkApiKeys() {
    // Больше не нужно вручную фильтровать по .eq('user_id'), RLS политика сама отдаст ключи текущего юзера
    const { data, error } = await supabase.from('api_keys').select('key_value');
    
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
    if (!key) return;
    
    if (userApiKeys.length >= 5) {
        alert("Максимум можно добавить 5 ключей!");
        return;
    }
    
    // Поле user_id заполнится автоматически благодаря связке с auth.users, 
    // но для надежности укажем его через currentUser.id
    const { error } = await supabase.from('api_keys').insert([{ user_id: currentUser.id, key_value: key }]);
    
    if (error) {
        alert("Ошибка добавления: " + error.message);
    } else {
        userApiKeys.push(key);
        document.getElementById('keys-list').innerHTML += `<li>Ключ добален (всего: ${userApiKeys.length})</li>`;
        document.getElementById('api-key-input').value = '';
        document.getElementById('btn-finish-keys').classList.remove('hidden');
    }
});

document.getElementById('btn-finish-keys').addEventListener('click', () => {
    document.getElementById('api-key-modal').classList.add('hidden');
    startApp();
});

// === ЗАПУСК ПРИЛОЖЕНИЯ ===
async function startApp() {
    document.getElementById('app-screen').classList.remove('hidden');
    // Дефолтный заглушечный персонаж для проверки
    currentPersona = { id: 'test', name: 'Психолог', system_prompt: 'Ты опытный психолог.' };
    document.getElementById('chat-input-area').classList.remove('hidden');
    document.getElementById('chat-header').innerText = `Чат: ${currentPersona.name}`;
}

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
    if (!text) return;

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
        chatBox.lastElementChild.remove(); // Отмена отправки сообщения при полной ошибке
    }
});