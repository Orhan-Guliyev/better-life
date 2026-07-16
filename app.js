// === КОНФИГУРАЦИЯ SUPABASE ===
const SUPABASE_URL = 'https://lcxbcxagitcilklmniwe.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_lhqj8KIXDVvXTvcTuHTMzw_G6JytrCL';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let userApiKeys = [];       // Массив обычных ключей для чата
let masterApiKeyObj = null; // Объект мастер-ключа для памяти (с префиксом MASTER:: в БД)

let currentPersona = null;
let currentChatHistory = []; 
let currentSummary = "";     
let currentAttachments = []; // Массив для файлов перед отправкой

// Первая логика: Перечень моделей для ОБЫЧНОГО чата
const GEMINI_MODELS = [
    'gemini-3.1-flash-lite', 
    'gemini-3-flash-preview', 
    'gemini-3.5-flash',   
    'gemini-2.5-flash' 
];

// Вторая логика: Перечень моделей для СУММАРИЗАЦИИ ПАМЯТИ
const MEMORY_MODELS = [
    'gemini-3.5-flash',       
    'gemini-3-flash-preview', 
    'gemini-3.1-flash-lite',  
    'gemini-2.5-flash'        
];

// === ЖДЕМ ЗАГРУЗКИ DOM ПЕРЕД ПРИВЯЗКОЙ СОБЫТИЙ ===
document.addEventListener('DOMContentLoaded', () => {

    // Открытие окна выбора файлов
    document.getElementById('btn-attach').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });

    // Обработка выбранных файлов
    document.getElementById('file-input').addEventListener('change', async (e) => {
        const files = e.target.files;
        for (let file of files) {
            const base64 = await fileToBase64(file);
            currentAttachments.push({ file, base64 });
        }
        renderPreviews();
        e.target.value = ''; // Сбрасываем инпут
    });

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

    document.getElementById('btn-save-setup-keys').addEventListener('click', async () => {
        const needsRegular = userApiKeys.length === 0;
        const needsMaster = !masterApiKeyObj;

        const regVal = document.getElementById('setup-regular-key').value.trim();
        const mastVal = document.getElementById('setup-master-key').value.trim();

        if (needsRegular && !regVal) return alert("Введите обычный API ключ!");
        if (needsMaster && !mastVal) return alert("Введите мастер-ключ!");

        const checkReg = needsRegular ? regVal : userApiKeys[0].key_value;
        const checkMast = needsMaster ? mastVal : masterApiKeyObj.key_value.replace('MASTER::', '');

        if (checkReg === checkMast) {
            return alert("Обычный ключ и мастер-ключ не должны совпадать!");
        }

        const inserts = [];
        if (needsRegular) inserts.push({ user_id: currentUser.id, key_value: regVal });
        if (needsMaster) inserts.push({ user_id: currentUser.id, key_value: `MASTER::${mastVal}` });

        if (inserts.length > 0) {
            const { error } = await supabaseClient.from('api_keys').insert(inserts);
            if (error) alert("Ошибка: " + error.message);
            else {
                document.getElementById('setup-regular-key').value = '';
                document.getElementById('setup-master-key').value = '';
                await checkApiKeys(); 
            }
        }
    });

    // === НАСТРОЙКИ КЛЮЧЕЙ ===
    document.getElementById('btn-settings').addEventListener('click', () => {
        renderSettingsKeys();
        document.getElementById('settings-modal').classList.remove('hidden');
    });

    document.getElementById('btn-close-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('hidden');
    });

    // Изменение Мастер-Ключа
    document.getElementById('btn-update-master').addEventListener('click', async () => {
        const newVal = document.getElementById('settings-master-key').value.trim();
        if (!newVal) return alert("Введите новый мастер-ключ!");

        // Проверка, чтобы мастер-ключ не совпадал ни с одним обычным
        if (userApiKeys.some(k => k.key_value === newVal)) {
            return alert("Мастер-ключ не может совпадать с обычным ключом!");
        }

        if (masterApiKeyObj) {
            const { error } = await supabaseClient.from('api_keys')
                .update({ key_value: `MASTER::${newVal}` })
                .eq('id', masterApiKeyObj.id);
            
            if (error) return alert(error.message);
            masterApiKeyObj.key_value = `MASTER::${newVal}`;
            alert("Мастер-ключ успешно обновлен!");
            renderSettingsKeys();
        }
    });

    // Добавление обычного ключа
    document.getElementById('btn-add-setting-key').addEventListener('click', async () => {
        const input = document.getElementById('new-setting-key');
        const newVal = input.value.trim();
        if (!newVal) return;

        // Проверка, чтобы обычный ключ не совпадал с мастер-ключом
        const currentMaster = masterApiKeyObj ? masterApiKeyObj.key_value.replace('MASTER::', '') : '';
        if (newVal === currentMaster) {
            return alert("Этот ключ уже используется как мастер-ключ!");
        }

        // Проверка на дубликаты обычных ключей
        if (userApiKeys.some(k => k.key_value === newVal)) {
            return alert("Такой обычный ключ уже добавлен!");
        }

        const { data, error } = await supabaseClient.from('api_keys')
            .insert([{ user_id: currentUser.id, key_value: newVal }])
            .select();

        if (error) alert(error.message);
        else {
            userApiKeys.push(data[0]);
            input.value = '';
            renderSettingsKeys();
        }
    });

    // Управление персонажами
    document.getElementById('btn-new-ai').addEventListener('click', () => {
        document.getElementById('ai-modal-title').innerText = "Создать ИИ";
        document.getElementById('edit-ai-id').value = "";
        document.getElementById('ai-name').value = "";
        document.getElementById('ai-prompt').value = "";
        document.getElementById('new-ai-modal').classList.remove('hidden');
    });

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

    document.getElementById('btn-clear-chat').addEventListener('click', async () => {
        if (!currentPersona) return;
        if (!confirm("Очистить историю сообщений? Контекст будет сохранен в долгосрочную память.")) return;

        const chatBox = document.getElementById('chat-messages');
        chatBox.innerHTML += `<div class="msg model typing">Архивирую сообщения в память...</div>`;
        chatBox.scrollTop = chatBox.scrollHeight;

        if (currentChatHistory.length > 0) await compressMemory();

        const { error } = await supabaseClient.from('chat_messages').delete().eq('persona_id', currentPersona.id);

        if (error) {
            alert("Ошибка очистки: " + error.message);
            chatBox.removeChild(chatBox.lastChild);
        } else {
            chatBox.innerHTML = '';
            alert("Экран очищен! Детали сохранены в памяти ИИ.");
        }
    });

    document.getElementById('btn-send').addEventListener('click', async () => {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        
        // Если нет ни текста, ни картинок - ничего не делаем
        if (!text && currentAttachments.length === 0) return;
        if (!currentPersona) return;

        const chatBox = document.getElementById('chat-messages');
        const attachmentsToSend = [...currentAttachments]; // Копируем текущие аттачи
        
        // Очищаем UI сразу для ощущения мгновенного отклика
        input.value = '';
        currentAttachments = [];
        renderPreviews();

        // 1. Формируем HTML для отображения в чате пользователя
        let userMessageHtml = '';
        attachmentsToSend.forEach(att => {
            userMessageHtml += `<img src="${att.base64}" class="chat-img">`; // Временно показываем base64
        });
        if (text) userMessageHtml += `<div>${text}</div>`;
        
        chatBox.innerHTML += `<div class="msg user">${userMessageHtml}</div>`;
        chatBox.scrollTop = chatBox.scrollHeight;

        // 2. Формируем Parts для Gemini
        let geminiParts = [];
        if (text) geminiParts.push({ text: text });
        
        attachmentsToSend.forEach(att => {
            // Отрезаем "data:image/jpeg;base64," чтобы передать чистый код в Gemini
            const pureBase64 = att.base64.split(',')[1];
            geminiParts.push({
                inlineData: {
                    data: pureBase64,
                    mimeType: att.file.type
                }
            });
        });

        currentChatHistory.push({ role: 'user', parts: geminiParts });

        // Пока ИИ думает, загружаем картинки в Supabase на фоне
        let dbMessageHtml = '';
        const uploadIndicator = document.createElement('div');
        uploadIndicator.className = 'msg model typing';
        uploadIndicator.innerText = 'Обработка и загрузка файлов...';
        chatBox.appendChild(uploadIndicator);
        chatBox.scrollTop = chatBox.scrollHeight;

        try {
            // Загружаем файлы в Supabase Storage
            for (let att of attachmentsToSend) {
                const fileExt = att.file.name.split('.').pop();
                const fileName = `${currentUser.id}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                
                const { data: uploadData, error: uploadError } = await supabaseClient.storage
                    .from('chat-images')
                    .upload(fileName, att.file);
                    
                if (uploadError) throw new Error("Ошибка загрузки картинки: " + uploadError.message);

                // Получаем публичную ссылку
                const { data: publicUrlData } = supabaseClient.storage.from('chat-images').getPublicUrl(fileName);
                dbMessageHtml += `<img src="${publicUrlData.publicUrl}" class="chat-img"><br>`;
            }
            if (text) dbMessageHtml += text;

            // Сохраняем сообщение пользователя (с публичными ссылками на фото) в БД
            await supabaseClient.from('chat_messages').insert([{
                user_id: currentUser.id, 
                persona_id: currentPersona.id, 
                role: 'user', 
                message_text: dbMessageHtml || text 
            }]);

            // Меняем индикатор на "ИИ думает"
            uploadIndicator.innerText = 'Печатает...';

            if (currentChatHistory.length >= 30) await compressMemory();

            // Отправляем запрос в Gemini
            const reply = await sendGeminiChatRequest(currentChatHistory, currentPersona.system_prompt);
            uploadIndicator.remove();

            // Показываем ответ ИИ
            chatBox.innerHTML += `<div class="msg model">${reply}</div>`;
            chatBox.scrollTop = chatBox.scrollHeight;

            currentChatHistory.push({ role: 'model', parts: [{ text: reply }] });

            // Сохраняем ответ ИИ в БД
            await supabaseClient.from('chat_messages').insert([{
                user_id: currentUser.id, persona_id: currentPersona.id, role: 'model', message_text: reply
            }]);

        } catch (error) {
            if (uploadIndicator) uploadIndicator.remove();
            alert(error.message);
            // Удаляем сломанное сообщение из истории
            if (chatBox.lastElementChild && chatBox.lastElementChild.classList.contains('user')) {
                chatBox.lastElementChild.remove();
            }
            currentChatHistory.pop(); 
        }
    });

}); // КОНЕЦ БЛОКА DOMContentLoaded

// === СИСТЕМА КЛЮЧЕЙ (БЕЗ ИЗМЕНЕНИЯ БАЗЫ ДАННЫХ) ===
async function checkApiKeys() {
    const { data, error } = await supabaseClient.from('api_keys').select('id, key_value');
    
    userApiKeys = [];
    masterApiKeyObj = null;

    if (data) {
        data.forEach(k => {
            if (k.key_value.startsWith('MASTER::')) {
                masterApiKeyObj = k;
            } else {
                userApiKeys.push(k);
            }
        });
    }

    const needsRegular = userApiKeys.length === 0;
    const needsMaster = !masterApiKeyObj;

    if (needsRegular || needsMaster) {
        document.getElementById('setup-regular-container').style.display = needsRegular ? 'flex' : 'none';
        document.getElementById('setup-master-container').style.display = needsMaster ? 'flex' : 'none';
        document.getElementById('api-key-modal').classList.remove('hidden');
    } else {
        document.getElementById('api-key-modal').classList.add('hidden');
        startApp();
    }
}

function renderSettingsKeys() {
    const masterClean = masterApiKeyObj ? masterApiKeyObj.key_value.replace('MASTER::', '') : 'Не установлен';
    document.getElementById('current-master-display').innerText = `Текущий: ${masterClean}`;
    document.getElementById('settings-master-key').value = '';

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
    if (userApiKeys.length <= 1) return alert("Нельзя удалить единственный обычный ключ!");
    const { error } = await supabaseClient.from('api_keys').delete().eq('id', id);
    if (error) alert(error.message);
    else {
        userApiKeys = userApiKeys.filter(k => k.id !== id);
        renderSettingsKeys();
    }
};

// === ЯДРО ПРИЛОЖЕНИЯ ===
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
    const { data } = await supabaseClient.from('ai_personas').select('*').order('created_at', { ascending: true });
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

async function selectPersona(persona) {
    currentPersona = persona;
    const chatHeader = document.getElementById('chat-header-text');
    const chatBox = document.getElementById('chat-messages');
    
    chatHeader.innerText = `Чат: ${persona.name}`;
    document.getElementById('btn-clear-chat').classList.remove('hidden');
    chatBox.innerHTML = '<i style="color:#888;">Загрузка истории...</i>'; 
    document.getElementById('chat-input-area').classList.remove('hidden');

    currentSummary = persona.ai_memory || ""; 
    currentChatHistory = [];
    
    if (currentSummary) {
        currentChatHistory.push(
            { role: 'user', parts: [{ text: `[Важная системная память из прошлых бесед: ${currentSummary}]` }] },
            { role: 'model', parts: [{ text: "[Внутренняя память успешно синхронизирована.]" }] }
        );
    }

    const { data } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .eq('persona_id', persona.id)
        .order('created_at', { ascending: true });

    chatBox.innerHTML = ''; 

    if (data && data.length > 0) {
        data.forEach(msg => {
            chatBox.innerHTML += `<div class="msg ${msg.role}">${msg.message_text}</div>`;
            currentChatHistory.push({ role: msg.role, parts: [{ text: msg.message_text }] });
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

function openEditModal(persona) {
    document.getElementById('ai-modal-title').innerText = "Редактировать ИИ";
    document.getElementById('edit-ai-id').value = persona.id;
    document.getElementById('ai-name').value = persona.name;
    document.getElementById('ai-prompt').value = persona.system_prompt;
    document.getElementById('new-ai-modal').classList.remove('hidden');
}

async function deletePersona(id) {
    if (!confirm("Удалить ИИ?")) return;
    await supabaseClient.from('ai_personas').delete().eq('id', id);
    if (currentPersona && currentPersona.id === id) startApp(); else await loadPersonas();
}

// API Запросы
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

// Логика 1: ЧАТ (Обычные ключи)
async function sendGeminiChatRequest(contents, systemInstructionText) {
    for (let model of GEMINI_MODELS) {
        for (let keyObj of userApiKeys) {
            try {
                return await fetchFromApi(model, keyObj.key_value, contents, systemInstructionText);
            } catch (e) {
                console.warn(`[Чат] Сбой на модели ${model} с одним из ключей`);
            }
        }
    }
    throw new Error("Все обычные API-ключи или лимиты моделей чата исчерпаны.");
}

// Логика 2: ПАМЯТЬ (Только Мастер-Ключ)
async function makeMemoryNetworkCall(contents) {
    if (!masterApiKeyObj) throw new Error("Мастер-ключ не найден.");
    
    const cleanMasterKey = masterApiKeyObj.key_value.replace('MASTER::', '');

    for (let model of MEMORY_MODELS) {
        try {
            return await fetchFromApi(model, cleanMasterKey, contents, "Ты — системный модуль сжатия памяти контекста. Пиши только чистые факты.");
        } catch (e) {
            console.warn(`[Модуль памяти] Модель ${model} выдала ошибку.`);
        }
    }
    throw new Error("Мастер-ключ исчерпал лимиты на всех моделях суммаризации.");
}

async function compressMemory() {
    console.log("Запущена оптимизация памяти ИИ...");
    const dialogSnapshot = currentChatHistory.map(m => `${m.role === 'user' ? 'Пользователь' : 'ИИ'}: ${m.parts[0].text}`).join('\n');

    const compressionPrompt = `Извлеки все важные факты о пользователе и контекст. Сформируй обновленную базу знаний.
    Предыдущая память: ${currentSummary || 'Отсутствует'}
    Новые сообщения: ${dialogSnapshot}`;

    try {
        const compressedResult = await makeMemoryNetworkCall([{ role: 'user', parts: [{ text: compressionPrompt }] }]);
        currentSummary = compressedResult;

        await supabaseClient.from('ai_personas').update({ ai_memory: currentSummary }).eq('id', currentPersona.id);

        currentChatHistory = [
            { role: 'user', parts: [{ text: `[Важная системная память из прошлых бесед: ${currentSummary}]` }] },
            { role: 'model', parts: [{ text: "[Контекст успешно оптимизирован.]" }] }
        ];
        console.log("Память обновлена.");
    } catch (e) {
        console.error("Не удалось оптимизировать память:", e);
    }
}

// Конвертируем файл в Base64 для отображения превью и отправки в Gemini
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// Отрисовка превью
function renderPreviews() {
    const container = document.getElementById('attachment-preview');
    container.innerHTML = '';
    if (currentAttachments.length === 0) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    
    currentAttachments.forEach((att, index) => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        div.innerHTML = `
            <img src="${att.base64}" alt="preview">
            <button class="btn-remove-preview" onclick="removeAttachment(${index})">✕</button>
        `;
        container.appendChild(div);
    });
}

// Удаление картинки из превью (сделаем функцию глобальной для onclick)
window.removeAttachment = function(index) {
    currentAttachments.splice(index, 1);
    renderPreviews();
};