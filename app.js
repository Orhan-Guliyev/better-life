// === КОНФИГУРАЦИЯ SUPABASE ===
const SUPABASE_URL = 'https://lcxbcxagitcilklmniwe.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_lhqj8KIXDVvXTvcTuHTMzw_G6JytrCL';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === ВТОРАЯ ЛОГИКА: ЕДИНЫЙ КЛЮЧ РАЗРАБОТЧИКА ДЛЯ ХРАНЕНИЯ ПАМЯТИ ===
const DEVELOPER_MEMORY_KEY = 'ВАШ_ЛИЧНЫЙ_API_КЛЮЧ_GEMINI'; 

let currentUser = null;
let userApiKeys = []; 
let currentPersona = null;
let currentChatHistory = []; // Оперативный контекст ИИ для текущей сессии
let currentSummary = "";     // Долгосрочная память ИИ (загружается и сохраняется в БД)

// Первая логика: Перечень моделей для ОБЫЧНОГО чата пользователей
const GEMINI_MODELS = [
    'gemini-3.1-flash-lite', 
    'gemini-3-flash-preview', 
    'gemini-3.5-flash', 
    'gemini-2.5-flash' 
];

// Вторая логика: Перечень моделей для СУММАРИЗАЦИИ ПАМЯТИ (от сильнейшей к слабейшей)
const MEMORY_MODELS = [
    'gemini-3.5-flash',       
    'gemini-3-flash-preview', 
    'gemini-3.1-flash-lite',  
    'gemini-2.5-flash'        
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

// Проверка ключей
async function checkApiKeys() {
    const { data, error } = await supabaseClient.from('api_keys').select('id, key_value');
    if (data && data.length > 0) {
        userApiKeys = data; 
        document.getElementById('api-key-modal').classList.add('hidden');
        startApp();
    } else {
        userApiKeys = [];
        document.getElementById('api-key-modal').classList.remove('hidden');
    }
}

document.getElementById('btn-add-key').addEventListener('click', async () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) return alert("Введите ключ!");
    const { data, error } = await supabaseClient.from('api_keys').insert([{ user_id: currentUser.id, key_value: key }]).select();
    if (error) alert("Ошибка: " + error.message);
    else {
        userApiKeys.push(data[0]);
        document.getElementById('keys-list').innerHTML += `<li>Ключ сохранен!</li>`;
        document.getElementById('api-key-input').value = '';
        document.getElementById('btn-finish-keys').classList.remove('hidden');
    }
});

document.getElementById('btn-finish-keys').addEventListener('click', () => {
    document.getElementById('api-key-modal').classList.add('hidden');
    startApp();
});

// Настройки
document.getElementById('btn-settings').addEventListener('click', () => {
    renderSettingsKeys();
    document.getElementById('settings-modal').classList.remove('hidden');
});
document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
});

function renderSettingsKeys() {
    const container = document.getElementById('settings-keys-list');
    container.innerHTML = '';
    userApiKeys.forEach(k => {
        const row = document.createElement('div');
        row.className = 'key-row';
        row.innerHTML = `<span class="key-text" title="${k.key_value}">${k.key_value}</span><button onclick="deleteApiKey('${k.id}')">Удалить</button>`;
        container.appendChild(row);
    });
}

window.deleteApiKey = async function(id) {
    if (userApiKeys.length <= 1) return alert("Нельзя удалить единственный ключ!");
    const { error } = await supabaseClient.from('api_keys').delete().eq('id', id);
    if (error) alert(error.message);
    else {
        userApiKeys = userApiKeys.filter(k => k.id !== id);
        renderSettingsKeys();
    }
};

document.getElementById('btn-add-setting-key').addEventListener('click', async () => {
    const input = document.getElementById('new-setting-key');
    const key = input.value.trim();
    if (!key) return;
    const { data, error } = await supabaseClient.from('api_keys').insert([{ user_id: currentUser.id, key_value: key }]).select();
    if (error) alert(error.message);
    else {
        userApiKeys.push(data[0]);
        input.value = '';
        renderSettingsKeys();
    }
});

async function startApp() {
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('chat-input-area').classList.add('hidden'); 
    document.getElementById('chat-header-text').innerText = `Выберите ИИ для начала общения`;
    document.getElementById('btn-clear-chat').classList.add('hidden');
    document.getElementById('chat-messages').innerHTML = '';
    currentPersona = null;
    currentChatHistory = [];
    currentSummary = "";
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
            li.onclick = () => selectPersona(persona);
            li.innerHTML = `
                <span class="ai-name">${persona.name}</span>
                <div class="ai-actions">
                    <button class="btn-edit">✏️</button>
                    <button class="btn-del">🗑️</button>
                </div>
            `;
            li.querySelector('.btn-edit').addEventListener('click', (e) => { e.stopPropagation(); openEditModal(persona); });
            li.querySelector('.btn-del').addEventListener('click', (e) => { e.stopPropagation(); deletePersona(persona.id); });
            list.appendChild(li);
        });
    }
}

// === ВЫБОР ИИ И РАЗДЕЛЬНАЯ ЗАГРУЗКА ИСТОРИИ И ПАМЯТИ ===
async function selectPersona(persona) {
    currentPersona = persona;
    const chatHeader = document.getElementById('chat-header-text');
    const chatBox = document.getElementById('chat-messages');
    
    chatHeader.innerText = `Чат: ${persona.name}`;
    document.getElementById('btn-clear-chat').classList.remove('hidden');
    chatBox.innerHTML = '<i style="color:#888;">Загрузка истории...</i>'; 
    document.getElementById('chat-input-area').classList.remove('hidden');

    // 1. Инициализируем ДОЛГОСРОЧНУЮ ПАМЯТЬ нейросети из нового столбца таблицы ai_personas
    currentSummary = persona.ai_memory || ""; 
    
    // 2. Собираем внутренний контекст ИИ: сначала скармливаем ему архив памяти (если он есть)
    currentChatHistory = [];
    if (currentSummary) {
        currentChatHistory.push(
            { role: 'user', parts: [{ text: `[Важная системная память из прошлых бесед: ${currentSummary}]` }] },
            { role: 'model', parts: [{ text: "[Внутренняя память успешно синхронизирована. Я помню контекст наших прошлых разговоров.]" }] }
        );
    }

    // 3. Загружаем ВИЗУАЛЬНУЮ историю переписки только для отображения пользователю на экране
    const { data, error } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .eq('persona_id', persona.id)
        .order('created_at', { ascending: true });

    chatBox.innerHTML = ''; 

    if (data && data.length > 0) {
        data.forEach(msg => {
            // Рисуем на экране то, что видит человек
            chatBox.innerHTML += `<div class="msg ${msg.role}">${msg.message_text}</div>`;
            
            // Также добавляем текущие сообщения в оперативку ИИ (чтобы он ориентировался в рамках текущей сессии)
            currentChatHistory.push({
                role: msg.role,
                parts: [{ text: msg.message_text }]
            });
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

// Управление персонажами
document.getElementById('btn-new-ai').addEventListener('click', () => {
    document.getElementById('ai-modal-title').innerText = "Создать нового ИИ";
    document.getElementById('edit-ai-id').value = "";
    document.getElementById('ai-name').value = "";
    document.getElementById('ai-prompt').value = "";
    document.getElementById('new-ai-modal').classList.remove('hidden');
});

function openEditModal(persona) {
    document.getElementById('ai-modal-title').innerText = "Редактировать ИИ";
    document.getElementById('edit-ai-id').value = persona.id;
    document.getElementById('ai-name').value = persona.name;
    document.getElementById('ai-prompt').value = persona.system_prompt;
    document.getElementById('new-ai-modal').classList.remove('hidden');
}

document.getElementById('btn-close-ai').addEventListener('click', () => {
    document.getElementById('new-ai-modal').classList.add('hidden');
});

document.getElementById('btn-save-ai').addEventListener('click', async () => {
    const id = document.getElementById('edit-ai-id').value;
    const name = document.getElementById('ai-name').value.trim();
    const prompt = document.getElementById('ai-prompt').value.trim();
    
    if (!name || !prompt) return alert("Заполните поля!");
    
    if (id) {
        await supabaseClient.from('ai_personas').update({ name, system_prompt: prompt }).eq('id', id);
    } else {
        await supabaseClient.from('ai_personas').insert([{ user_id: currentUser.id, name, system_prompt: prompt }]);
    }
    document.getElementById('new-ai-modal').classList.add('hidden');
    await loadPersonas();
});

async function deletePersona(id) {
    if (!confirm("Удалить ИИ?")) return;
    await supabaseClient.from('ai_personas').delete().eq('id', id);
    if (currentPersona && currentPersona.id === id) startApp(); else await loadPersonas();
}

// Базовый сетевой метод API
async function fetchFromApi(model, apiKey, contents, systemInstructionText) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = { contents: contents };
    if (systemInstructionText) body.system_instruction = { parts: [{ text: systemInstructionText }] };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Ошибка API');
    return data.candidates[0].content.parts[0].text;
}

// === ПЕРВАЯ ЛОГИКА: РАБОТА ОБЫЧНОГО ЧАТА (КЛЮЧИ ПОЛЬЗОВАТЕЛЕЙ) ===
async function sendGeminiChatRequest(contents, systemInstructionText) {
    for (let model of GEMINI_MODELS) {
        for (let keyObj of userApiKeys) {
            try {
                return await fetchFromApi(model, keyObj.key_value, contents, systemInstructionText);
            } catch (e) {
                console.warn(`[Чат] Сбой на модели ${model}`);
            }
        }
    }
    throw new Error("Все API-ключи пользователя или лимиты моделей чата исчерпаны.");
}

// === ВТОРАЯ ЛОГИКА: СУММАРИЗАЦИЯ НА ВАШЕМ ОДНОМ КЛЮЧЕ (СВЕРХУ ВНИЗ) ===
async function makeMemoryNetworkCall(contents) {
    if (!DEVELOPER_MEMORY_KEY || DEVELOPER_MEMORY_KEY === 'ВАШ_ЛИЧНЫЙ_API_КЛЮЧ_GEMINI') {
        throw new Error("Критическая ошибка: Не задан мастер-ключ разработчика для оптимизации памяти.");
    }
    for (let model of MEMORY_MODELS) {
        try {
            return await fetchFromApi(model, DEVELOPER_MEMORY_KEY, contents, "Ты — системный модуль сжатия памяти контекста. Пиши только чистые факты.");
        } catch (e) {
            console.warn(`[Модуль памяти] Модель ${model} выдала ошибку. Спуск по каскаду ниже...`);
        }
    }
    throw new Error("Все модели каскада памяти на мастер-ключе вернули ошибку.");
}

// === ОПТИМИЗАЦИЯ ПАМЯТИ ПРИ ДОСТИЖЕНИИ 30 СООБЩЕНИЙ С СОХРАНЕНИЕМ В БД ===
async function compressMemory() {
    console.log("Запущена оптимизация памяти ИИ (достигнут лимит в 30 сообщений)...");
    
    const dialogSnapshot = currentChatHistory.map(m => {
        return `${m.role === 'user' ? 'Пользователь' : 'ИИ'}: ${m.parts[0].text}`;
    }).join('\n');

    const compressionPrompt = `Внимательно изучи историю диалога. Извлеки все важные факты о пользователе, контекст беседы и ключевые договоренности. Сформируй обновленную лаконичную базу знаний для ИИ, объединив её с предыдущей памятью.
    
    Предыдущая память:
    ${currentSummary || 'Отсутствует'}
    
    Новые сообщения для анализа:
    ${dialogSnapshot}`;

    try {
        // Выполняем суммаризацию по ВТОРОЙ логике на вашем ключе
        const compressedResult = await makeMemoryNetworkCall([{ role: 'user', parts: [{ text: compressionPrompt }] }]);
        currentSummary = compressedResult;

        // !!! КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: Намертво сохраняем эту память в базу данных !!!
        await supabaseClient
            .from('ai_personas')
            .update({ ai_memory: currentSummary })
            .eq('id', currentPersona.id);

        // Пересобираем оперативную память ИИ, разгружая контекст
        currentChatHistory = [
            { role: 'user', parts: [{ text: `[Важная системная память из прошлых бесед: ${currentSummary}]` }] },
            { role: 'model', parts: [{ text: "[Контекст успешно оптимизирован и сохранен в БД.]" }] }
        ];
        console.log("Долгосрочная память ИИ обновлена в Базе Данных.");
    } catch (e) {
        console.error("Не удалось оптимизировать память нейросети:", e);
    }
}

// === КНОПКА «ОЧИСТИТЬ ЧАТ» (ОЧИЩАЕТ ЭКРАН, НЕ ТРОГАЯ ПАМЯТЬ НЕЙРОСЕТИ) ===
document.getElementById('btn-clear-chat').addEventListener('click', async () => {
    if (!currentPersona) return;
    if (!confirm("Очистить историю сообщений с экрана? Нейросеть всё равно продолжит помнить контекст общения.")) return;

    // Удаляем переписку только из таблицы сообщений (удаляется визуальный слой)
    const { error } = await supabaseClient
        .from('chat_messages')
        .delete()
        .eq('persona_id', currentPersona.id);

    if (error) {
        alert("Ошибка очистки: " + error.message);
    } else {
        // Очищаем экран пользователя
        document.getElementById('chat-messages').innerHTML = '';
        alert("Экран очищен! Внутренняя память ИИ осталась нетронутой в базе данных.");
    }
});

// === ОТПРАВКА СООБЩЕНИЙ ===
document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !currentPersona) return;

    const chatBox = document.getElementById('chat-messages');
    
    chatBox.innerHTML += `<div class="msg user">${text}</div>`;
    input.value = '';
    chatBox.scrollTop = chatBox.scrollHeight;

    currentChatHistory.push({ role: 'user', parts: [{ text: text }] });

    // Пишем в БД для отображения на экране
    await supabaseClient.from('chat_messages').insert([{
        user_id: currentUser.id,
        persona_id: currentPersona.id,
        role: 'user',
        message_text: text
    }]);

    // Каждые 30 сообщений сессии сжимаем память
    if (currentChatHistory.length >= 30) {
        await compressMemory();
    }

    // Включаем индикатор "Печатает..."
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'msg model typing';
    typingIndicator.innerText = 'Печатает...';
    chatBox.appendChild(typingIndicator);
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        // Запрос ответа по первой логике (ключи пользователя)
        const reply = await sendGeminiChatRequest(currentChatHistory, currentPersona.system_prompt);
        
        typingIndicator.remove();

        chatBox.innerHTML += `<div class="msg model">${reply}</div>`;
        chatBox.scrollTop = chatBox.scrollHeight;

        currentChatHistory.push({ role: 'model', parts: [{ text: reply }] });

        await supabaseClient.from('chat_messages').insert([{
            user_id: currentUser.id,
            persona_id: currentPersona.id,
            role: 'model',
            message_text: reply
        }]);

    } catch (error) {
        if (typingIndicator) typingIndicator.remove();
        alert(error.message);
        if (chatBox.lastElementChild && chatBox.lastElementChild.classList.contains('user')) chatBox.lastElementChild.remove();
        currentChatHistory.pop(); 
    }
});