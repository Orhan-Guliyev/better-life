// === КОНФИГУРАЦИЯ ===
const firebaseConfig = {
    apiKey: "AIzaSyBhGHPzLQQc0Ww8Cqfuvhl__sEA5zzYOfY",
    authDomain: "better-life-5eb0a.firebaseapp.com",
    projectId: "better-life-5eb0a",
};

const SUPABASE_URL = 'https://lcxbcxagitcilklmniwe.supabase.co';
const SUPABASE_ANON_KEY = 'sb_secret_OKHVhL5J3aYPeGtjzABiUw_FC8op5yF';

// === ИНИЦИАЛИЗАЦИЯ ===
const { initializeApp, getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } = window.firebaseDocs;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let userApiKeys = [];
let currentPersona = null;

// Иерархия моделей для даунгрейда (от лучшей к базовой)
const GEMINI_MODELS = [
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash-latest',
    'gemini-1.0-pro'
];

// === АВТОРИЗАЦИЯ ===
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-screen').classList.add('hidden');
        await checkApiKeys();
    } else {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
});

document.getElementById('btn-login').addEventListener('click', () => {
    signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value)
        .catch(err => alert("Ошибка входа: " + err.message));
});

document.getElementById('btn-register').addEventListener('click', () => {
    createUserWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value)
        .catch(err => alert("Ошибка регистрации: " + err.message));
});

// === ЛОГИКА API КЛЮЧЕЙ ===
async function checkApiKeys() {
    const { data, error } = await supabase.from('api_keys').select('key_value').eq('user_id', currentUser.uid);
    if (data && data.length > 0) {
        userApiKeys = data.map(k => k.key_value);
        startApp();
    } else {
        document.getElementById('api-key-modal').classList.remove('hidden');
    }
}

document.getElementById('btn-add-key').addEventListener('click', async () => {
    const key = document.getElementById('api-key-input').value;
    if (!key) return;
    
    await supabase.from('api_keys').insert([{ user_id: currentUser.uid, key_value: key }]);
    document.getElementById('keys-list').innerHTML += `<li>Ключ добавлен!</li>`;
    document.getElementById('api-key-input').value = '';
    document.getElementById('btn-finish-keys').classList.remove('hidden');
});

document.getElementById('btn-finish-keys').addEventListener('click', () => {
    document.getElementById('api-key-modal').classList.add('hidden');
    checkApiKeys();
});

// === ЗАПУСК ПРИЛОЖЕНИЯ И ЗАГРУЗКА ИИ ===
async function startApp() {
    document.getElementById('app-screen').classList.remove('hidden');
    // Здесь должна быть загрузка списка ИИ из таблицы ai_personas (опущено для краткости)
    // Для теста создадим фейкового ИИ:
    currentPersona = { id: 'test', name: 'Психолог', system_prompt: 'Ты опытный психолог.' };
    document.getElementById('chat-input-area').classList.remove('hidden');
    document.getElementById('chat-header').innerText = `Чат: ${currentPersona.name}`;
}

// === УМНАЯ СИСТЕМА ОТПРАВКИ И РОУТИНГ КЛЮЧЕЙ ===
async function sendGeminiRequest(promptText) {
    // Проходимся по моделям (от лучшей к худшей)
    for (let model of GEMINI_MODELS) {
        console.log(`Пробуем модель: ${model}`);
        
        // Проходимся по всем доступным ключам пользователя
        for (let apiKey of userApiKeys) {
            console.log(`Пробуем ключ: ${apiKey.substring(0, 8)}...`);
            
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
                    // Ошибка 429 - Too Many Requests (Закончились лимиты/токены)
                    if (response.status === 429 || data.error?.code === 429) {
                        console.warn('Лимит исчерпан. Переход к следующему ключу/модели.');
                        continue; // Переходим к следующему ключу в цикле
                    }
                    throw new Error(data.error?.message || 'Неизвестная ошибка API');
                }

                // Успех! Возвращаем текст
                return data.candidates[0].content.parts[0].text;

            } catch (error) {
                console.error("Ошибка при запросе:", error);
                // Если ошибка сети или другая критическая, продолжаем попытки с другими ключами
            }
        }
    }
    
    // Если все циклы завершились и мы здесь — значит ничего не сработало
    throw new Error("Все API ключи и модели исчерпаны. Попробуйте позже.");
}

// === ОБРАБОТКА ЧАТА ===
document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;

    const chatBox = document.getElementById('chat-messages');
    
    // Показываем сообщение пользователя
    chatBox.innerHTML += `<div class="msg user">${text}</div>`;
    input.value = '';

    try {
        // Запускаем наш каскадный алгоритм
        const reply = await sendGeminiRequest(text);
        
        // Показываем ответ ИИ
        chatBox.innerHTML += `<div class="msg model">${reply}</div>`;
        chatBox.scrollTop = chatBox.scrollHeight;
        
        // (Опционально) Сохраняем в Supabase в таблицу messages
    } catch (error) {
        alert(error.message);
        // Отмена сообщения: удаляем последнее отправленное (или помечаем как ошибку)
        chatBox.lastElementChild.remove(); 
    }
});