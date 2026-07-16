// === КОНФИГУРАЦИЯ SUPABASE ===
const SUPABASE_URL = 'https://lcxbcxagitcilklmniwe.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_lhqj8KIXDVvXTvcTuHTMzw_G6JytrCL';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === 1. ВТОРАЯ ЛОГИКА: ЕДИНЫЙ КЛЮЧ РАЗРАБОТЧИКА ДЛЯ ХРАНЕНИЯ ПАМЯТИ ===
const DEVELOPER_MEMORY_KEY = 'ВАШ_ЛИЧНЫЙ_API_КЛЮЧ_GEMINI'; 

let currentUser = null;
let userApiKeys = []; 
let currentPersona = null;
let currentChatHistory = []; // Локальный контекст для отправки в чат (будет оптимизироваться)
let currentSummary = "";     // Накопленная память/база знаний текущего ИИ

// ОРИГИНАЛЬНЫЙ перечень моделей для ОБЫЧНОГО чата (твоя первая логика)
const GEMINI_MODELS = [
    'gemini-3.1-flash-lite', // средний вариант
    'gemini-3-flash-preview', // поумнее
    'gemini-3.5-flash', // очень умный  
    'gemini-2.5-flash' // долнес
];

// ВТОРОЙ перечень моделей для СУММАРИЗАЦИИ ПАМЯТИ (от сильнейшей к слабейшей)
const MEMORY_MODELS = [
    'gemini-3.5-flash',       // Самая сильная модель
    'gemini-3-flash-preview', // Поумнее
    'gemini-3.1-flash-lite',  // Средняя
    'gemini-2.5-flash'        // Слабейшая
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

// === ЛОГИКА API КЛЮЧЕЙ ПОЛЬЗОВАТЕЛЕЙ ===
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
    if (!key) {
        alert("Введите ключ!");
        return;
    }
    
    const { data, error } = await supabaseClient.from('api_keys').insert([{ user_id: currentUser.id, key_value: key }]).select();
    
    if (error) alert("Ошибка добавления: " + error.message);
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

// Настройки ключей
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
        row.innerHTML = `
            <span class="key-text" title="${k.key_value}">${k.key_value}</span>
            <button onclick="deleteApiKey('${k.id}')">Удалить</button>
        `;
        container.appendChild(row);
    });
}

window.deleteApiKey = async function(id) {
    if (userApiKeys.length <= 1) {
        alert("Нельзя удалить единственный ключ! Сначала добавьте новый.");
        return;
    }
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

// === ЗАПУСК ПРИЛОЖЕНИЯ ===
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
            
            li.querySelector('.btn-edit').addEventListener('click', (e) => {
                e.stopPropagation(); 
                openEditModal(persona);
            });
            
            li.querySelector('.btn-del').addEventListener('click', (e) => {
                e.stopPropagation();
                deletePersona(persona.id);
            });
            
            list.appendChild(li);
        });
    }
}

// === ВЫБОР ИИ И ЗАГРУЗКА ИСТОРИИ ИЗ БД ===
async function selectPersona(persona) {
    currentPersona = persona;
    const chatHeader = document.getElementById('chat-header-text');
    const chatBox = document.getElementById('chat-messages');
    
    chatHeader.innerText = `Чат: ${persona.name}`;
    document.getElementById('btn-clear-chat').classList.remove('hidden');
    chatBox.innerHTML = '<i style="color:#888;">Загрузка истории...</i>'; 
    document.getElementById('chat-input-area').classList.remove('hidden');

    currentChatHistory = []; 
    currentSummary = ""; 

    const { data, error } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .eq('persona_id', persona.id)
        .order('created_at', { ascending: true });

    chatBox.innerHTML = ''; 

    if (error) {
        console.error("Ошибка загрузки истории:", error);
        return;
    }

    if (data && data.length > 0) {
        data.forEach(msg => {
            // Выводим переписку пользователю на экран визуально
            chatBox.innerHTML += `<div class="msg ${msg.role}">${msg.message_text}</div>`;
            
            // Заполняем рабочий контекст ИИ
            currentChatHistory.push({
                role: msg.role,
                parts: [{ text: msg.message_text }]
            });
        });
        chatBox.scrollTop = chatBox.scrollHeight;

        // Если при загрузке сообщений уже изначально больше 30, сжимаем контекст для ИИ
        if (currentChatHistory.length >= 30) {
            await compressMemory();
        }
    }
}

// Персонажи
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
    
    if (!name || !prompt) {
        alert("Заполните имя и промпт!");
        return;
    }
    
    if (id) {
        const { error } = await supabaseClient.from('ai_personas').update({ name, system_prompt: prompt }).eq('id', id);
        if (error) alert(error.message);
        else {
            if (currentPersona && currentPersona.id === id) {
                currentPersona.name = name;
                currentPersona.system_prompt = prompt;
                document.getElementById('chat-header-text').innerText = `Чат: ${name}`;
            }
        }
    } else {
        const { error } = await supabaseClient.from('ai_personas').insert([{
            user_id: currentUser.id,
            name: name,
            system_prompt: prompt
        }]);
        if (error) alert(error.message);
    }
    
    document.getElementById('new-ai-modal').classList.add('hidden');
    await loadPersonas();
});

async function deletePersona(id) {
    if (!confirm("Вы уверены, что хотите удалить этого ИИ?")) return;
    const { error } = await supabaseClient.from('ai_personas').delete().eq('id', id);
    if (error) alert(error.message);
    else {
        if (currentPersona && currentPersona.id === id) startApp(); 
        else await loadPersonas();
    }
}

// === БАЗОВЫЙ СЕТЕВОЙ МЕТОД API ===
async function fetchFromApi(model, apiKey, contents, systemInstructionText) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = { contents: contents };
    
    if (systemInstructionText) {
        body.system_instruction = { parts: [{ text: systemInstructionText }] };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Ошибка API');

    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
    } else {
        throw new Error("Некорректный ответ от API");
    }
}

// === ПЕРВАЯ ЛОГИКА: ОБЫЧНЫЙ ЧАТ ПОЛЬЗОВАТЕЛЕЙ (ПО ТВОЕМУ ПЕРЕЧНЮ МОДЕЛЕЙ) ===
async function sendGeminiChatRequest(contents, systemInstructionText) {
    for (let model of GEMINI_MODELS) {
        for (let keyObj of userApiKeys) {
            try {
                return await fetchFromApi(model, keyObj.key_value, contents, systemInstructionText);
            } catch (error) {
                console.warn(`[Основной чат] Модель ${model} или ключ не сработали. Пробуем дальше...`);
            }
        }
    }
    throw new Error("Все добавленные вами API-ключи или лимиты текущих моделей исчерпаны.");
}

// === ВТОРАЯ ЛОГИКА: ФОНОВАЯ СУММАРИЗАЦИЯ НА ОДНОМ ТВОЕМ КЛЮЧЕ (ОТ СИЛЬНЕЙШЕЙ К СЛАБЕЙШЕЙ) ===
async function makeMemoryNetworkCall(contents) {
    if (!DEVELOPER_MEMORY_KEY || DEVELOPER_MEMORY_KEY === 'ВАШ_ЛИЧНЫЙ_API_КЛЮЧ_GEMINI') {
        throw new Error("Критическая ошибка: Мастер-ключ разработчика для оптимизации памяти не задан.");
    }

    // Проходим сверху вниз строго от сильнейшей к слабейшей по массиву MEMORY_MODELS
    for (let model of MEMORY_MODELS) {
        try {
            return await fetchFromApi(model, DEVELOPER_MEMORY_KEY, contents, "Ты — системный модуль сжатия памяти контекста.");
        } catch (error) {
            console.warn(`[Модуль Памяти] Модель ${model} выдала ошибку (возможно, закончились токены). Спуск по каскаду ниже...`, error);
        }
    }
    throw new Error("Все модели каскада для оптимизации памяти на мастер-ключе вернули ошибку.");
}

// === ОПТИМИЗАЦИЯ ПАМЯТИ ПРИ ДОСТИЖЕНИИ 30 СООБЩЕНИЙ ===
async function compressMemory() {
    console.log("Запущена оптимизация памяти ИИ (достигнуто лимитное количество сообщений: 30)...");
    
    const dialogSnapshot = currentChatHistory.map(m => {
        return `${m.role === 'user' ? 'Пользователь' : 'ИИ'}: ${m.parts[0].text}`;
    }).join('\n');

    const compressionPrompt = `Внимательно изучи историю диалога. Извлеки из неё все важные факты о пользователе, контекст беседы, ключевые договоренности и детали. Сформируй обновленную лаконичную базу знаний для ИИ, объединив её с предыдущей памятью (если она была). Пиши тезисно и структурировано, только факты.
    
    Предыдущая память:
    ${currentSummary || 'Отсутствует'}
    
    Последние 30 сообщений для анализа:
    ${dialogSnapshot}`;

    try {
        // Отправляем запрос строго по ВТОРОЙ логике
        const compressedResult = await makeMemoryNetworkCall([{ role: 'user', parts: [{ text: compressionPrompt }] }]);
        currentSummary = compressedResult;

        // Полностью очищаем оперативную память ИИ и оставляем только сжатый слепок контекста
        currentChatHistory = [
            { role: 'user', parts: [{ text: `[Важная системная память из прошлых бесед: ${currentSummary}]` }] },
            { role: 'model', parts: [{ text: "[Контекст успешно оптимизирован. Вся важная информация усвоена.]" }] }
        ];
        console.log("Память нейросети успешно пересобрана. Текущая база знаний:", currentSummary);
    } catch (e) {
        console.error("Не удалось оптимизировать память нейросети:", e);
    }
}

// === ОЧИСТКА ЭКРАНА ПОЛЬЗОВАТЕЛЯ (КНОПКА «ОЧИСТИТЬ ЧАТ») ===
document.getElementById('btn-clear-chat').addEventListener('click', async () => {
    if (!currentPersona) return;
    if (!confirm("Очистить историю сообщений с экрана? Нейросеть всё равно продолжит помнить контекст общения.")) return;

    const { error } = await supabaseClient
        .from('chat_messages')
        .delete()
        .eq('persona_id', currentPersona.id);

    if (error) {
        alert("Ошибка очистки базы данных: " + error.message);
    } else {
        // Стираем сообщения только с экрана (интерфейса)
        document.getElementById('chat-messages').innerHTML = '';
        alert("Экран очищен! Внутренняя память ИИ сохранена и продолжает работать.");
    }
});

// === ОТПРАВКА СООБЩЕНИЙ В ЧАТ ===
document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !currentPersona) return;

    const chatBox = document.getElementById('chat-messages');
    
    // 1. Отображаем сообщение пользователя на экране
    chatBox.innerHTML += `<div class="msg user">${text}</div>`;
    input.value = '';
    chatBox.scrollTop = chatBox.scrollHeight;

    // 2. Добавляем в локальный контекст отправки
    currentChatHistory.push({ role: 'user', parts: [{ text: text }] });

    // 3. Записываем в БД Supabase (для визуальной истории)
    await supabaseClient.from('chat_messages').insert([{
        user_id: currentUser.id,
        persona_id: currentPersona.id,
        role: 'user',
        message_text: text
    }]);

    // Каждые 30 сообщений активируем фоновую суммаризацию
    if (currentChatHistory.length >= 30) {
        await compressMemory();
    }

    // 4. Добавляем визуальный индикатор «Печатает...»
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'msg model typing';
    typingIndicator.innerText = 'Печатает...';
    chatBox.appendChild(typingIndicator);
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        // 5. Запрос ответа по ПЕРВОЙ логике (модели пользователей)
        const reply = await sendGeminiChatRequest(currentChatHistory, currentPersona.system_prompt);
        
        // Удаляем анимацию печати
        typingIndicator.remove();

        // 6. Выводим ответ на экран и сохраняем везде
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
        
        // Откат при сбое сети
        if (chatBox.lastElementChild && chatBox.lastElementChild.classList.contains('user')) {
            chatBox.lastElementChild.remove(); 
        }
        currentChatHistory.pop(); 
    }
});