// === КОНФИГУРАЦИЯ SUPABASE ===
const SUPABASE_URL = 'https://lcxbcxagitcilklmniwe.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_lhqj8KIXDVvXTvcTuHTMzw_G6JytrCL';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let userApiKeys = []; 
let currentPersona = null;
let currentChatHistory = []; // Массив для хранения контекста диалога текущего ИИ

// Перечень актуальных бесплатных моделей Gemini в порядке убывания возможностей (Downgrade)
const GEMINI_MODELS = [
    'gemini-3.5-flash',        // 1. Основная флагманская бесплатная модель с максимальным интеллектом
    'gemini-3-flash-preview',  // 2. Высокопроизводительный резерв уровня Gemini 3
    'gemini-3.1-flash-lite',   // 3. Быстрая облегченная модель для разгрузки простых запросов
    'gemini-2.5-flash'         // 4. Финальный фолбек предыдущего поколения
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

// Добавление первого ключа при регистрации
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

// === УПРАВЛЕНИЕ НАСТРОЙКАМИ (МОДАЛКА КЛЮЧЕЙ) ===
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

// Удаление ключа из настроек
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

// Добавление нового ключа через настройки
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

// === ЗАПУСК ПРИЛОЖЕНИЯ И ЗАГРУЗКА ИИ ===
async function startApp() {
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('chat-input-area').classList.add('hidden'); 
    document.getElementById('chat-header').innerText = `Выберите ИИ для начала общения`;
    document.getElementById('chat-messages').innerHTML = '';
    currentPersona = null;
    currentChatHistory = [];
    
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
    const chatHeader = document.getElementById('chat-header');
    const chatBox = document.getElementById('chat-messages');
    
    chatHeader.innerText = `Чат: ${persona.name}`;
    chatBox.innerHTML = '<i style="color:#888;">Загрузка истории...</i>'; 
    document.getElementById('chat-input-area').classList.remove('hidden');

    currentChatHistory = []; // Очищаем локальный контекст

    // Загружаем сообщения именно этого ИИ
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
            // Отрисовываем визуально в окне
            chatBox.innerHTML += `<div class="msg ${msg.role}">${msg.message_text}</div>`;
            // Накапливаем структурированный массив контекста диалога для Gemini
            currentChatHistory.push({
                role: msg.role,
                parts: [{ text: msg.message_text }]
            });
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

// === СОЗДАНИЕ И РЕДАКТИРОВАНИЕ ИИ ===
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
                document.getElementById('chat-header').innerText = `Чат: ${name}`;
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

// Удаление ИИ
async function deletePersona(id) {
    if (!confirm("Вы уверены, что хотите удалить этого ИИ? (Вся переписка с ним также будет удалена)")) return;
    
    const { error } = await supabaseClient.from('ai_personas').delete().eq('id', id);
    if (error) alert(error.message);
    else {
        if (currentPersona && currentPersona.id === id) {
            startApp(); 
        } else {
            await loadPersonas();
        }
    }
}

// === РОУТИНГ КЛЮЧЕЙ И ОТПРАВКА СТРУКТУРИРОВАННОГО КОНТЕКСТА В GEMINI ===
async function sendGeminiRequest() {
    for (let model of GEMINI_MODELS) {
        for (let keyObj of userApiKeys) {
            try {
                const apiKey = keyObj.key_value;
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        system_instruction: { parts: [{ text: currentPersona.system_prompt }]},
                        contents: currentChatHistory // Отправляем полный массив переписки
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

                if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                    return data.candidates[0].content.parts[0].text;
                } else {
                    throw new Error("Некорректный формат ответа от Gemini API");
                }

            } catch (error) {
                console.error(`Попытка работы с моделью ${model} не удалась:`, error);
            }
        }
    }
    throw new Error("Все ваши API ключи или лимиты моделей Gemini полностью исчерпаны.");
}

// === ОТПРАВКА СООБЩЕНИЙ С СОХРАНЕНИЕМ В БД ===
document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !currentPersona) return;

    const chatBox = document.getElementById('chat-messages');
    
    // 1. Отображаем сообщение пользователя на веб-интерфейсе
    chatBox.innerHTML += `<div class="msg user">${text}</div>`;
    input.value = '';
    chatBox.scrollTop = chatBox.scrollHeight;

    // 2. Добавляем сообщение пользователя в локальный контекст диалога
    currentChatHistory.push({ role: 'user', parts: [{ text: text }] });

    // 3. Сохраняем сообщение пользователя в Supabase в таблицу chat_messages
    const { error: userMsgError } = await supabaseClient.from('chat_messages').insert([{
        user_id: currentUser.id,
        persona_id: currentPersona.id,
        role: 'user',
        message_text: text
    }]);
    
    if (userMsgError) {
        console.error("Ошибка при сохранении сообщения пользователя:", userMsgError);
    }

    try {
        // 4. Запрашиваем ответ ИИ с передачей полной истории диалога
        const reply = await sendGeminiRequest();
        
        // 5. Выводим ответ модели на экран
        chatBox.innerHTML += `<div class="msg model">${reply}</div>`;
        chatBox.scrollTop = chatBox.scrollHeight;

        // 6. Добавляем ответ модели в локальный контекст диалога
        currentChatHistory.push({ role: 'model', parts: [{ text: reply }] });

        // 7. Сохраняем ответ модели в Supabase в таблицу chat_messages
        const { error: modelMsgError } = await supabaseClient.from('chat_messages').insert([{
            user_id: currentUser.id,
            persona_id: currentPersona.id,
            role: 'model',
            message_text: reply
        }]);

        if (modelMsgError) {
            console.error("Ошибка при сохранении ответа модели:", modelMsgError);
        }

    } catch (error) {
        alert(error.message);
        // В случае критической ошибки API удаляем последнее сообщение пользователя из истории диалога и интерфейса
        if (chatBox.lastElementChild) {
            chatBox.lastElementChild.remove(); 
        }
        currentChatHistory.pop(); 
    }
});