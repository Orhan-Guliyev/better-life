// === КОНФИГУРАЦИЯ SUPABASE ===
const SUPABASE_URL = 'https://lcxbcxagitcilklmniwe.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_lhqj8KIXDVvXTvcTuHTMzw_G6JytrCL';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let userApiKeys = [];       
let masterApiKeyObj = null; 

let currentPersona = null;
let currentChatHistory = []; 
let currentSummary = "";     
let currentAttachments = []; 

const GEMINI_MODELS = [
    'gemini-3.1-flash-lite', 
    'gemini-3-flash-preview', 
    'gemini-3.5-flash',   
    'gemini-2.5-flash' 
];

const MEMORY_MODELS = [
    'gemini-3.5-flash',       
    'gemini-3-flash-preview', 
    'gemini-3.1-flash-lite',  
    'gemini-2.5-flash'        
];

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ БЕЗОПАСНОСТИ И ОФОРМЛЕНИЯ ===

// Маскирование ключей (видим только последние 4 символа)
function maskKey(key) {
    if (!key) return 'Не установлен';
    const clean = key.replace('MASTER::', '');
    if (clean.length <= 10) return '***';
    return `${clean.substring(0, 6)}...${clean.slice(-4)}`;
}

// Генерация аватаров (Ссылка или цветной круг с первой буквой)
function getAvatarHtml(name, url, isSmall = false) {
    const sizeClass = isSmall ? 'style="width:35px; height:35px; font-size:14px;"' : '';
    if (url && url.trim() !== '') {
        return `<img src="${url}" class="avatar-img" ${sizeClass} alt="${name}">`;
    }
    const firstLetter = name ? name.trim().charAt(0).toUpperCase() : '?';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = ['#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784', '#a1887f'];
    const colorIndex = Math.abs(hash) % colors.length;
    const bgColor = colors[colorIndex];
    
    return `<div class="avatar-fallback" style="background-color: ${bgColor};" ${sizeClass}>${firstLetter}</div>`;
}

// === СИСТЕМА УПРАВЛЕНИЯ ТЕМОЙ ===
function initTheme() {
    const savedMode = localStorage.getItem('theme-mode') || 'light';
    const savedColor = localStorage.getItem('theme-color') || '#2481cc';
    
    // Переключение темы (светлая / темная)
    if (savedMode === 'dark') {
        document.body.classList.add('dark-mode');
        document.getElementById('btn-theme-toggle').innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        document.body.classList.remove('dark-mode');
        document.getElementById('btn-theme-toggle').innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
    
    // Установка кастомного цвета
    document.documentElement.style.setProperty('--primary-color', savedColor);
    document.documentElement.style.setProperty('--primary-hover', adjustColorBrightness(savedColor, -15));
    
    // Выделение активного кружка в настройках
    document.querySelectorAll('.color-dot').forEach(dot => {
        if (dot.getAttribute('data-color') === savedColor) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
}

function toggleThemeMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme-mode', isDark ? 'dark' : 'light');
    document.getElementById('btn-theme-toggle').innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}

function setThemeColor(color) {
    localStorage.setItem('theme-color', color);
    document.documentElement.style.setProperty('--primary-color', color);
    document.documentElement.style.setProperty('--primary-hover', adjustColorBrightness(color, -15));
    
    document.querySelectorAll('.color-dot').forEach(dot => {
        if (dot.getAttribute('data-color') === color) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
}

// === ОБНОВЛЕННАЯ ФУНКЦИЯ АВАТАРОК ===
function getAvatarHtml(name, avatarData, isSmall = false) {
    const sizeClass = isSmall ? 'style="width:35px; height:35px; font-size:16px;"' : '';
    
    // Если это иконка из FontAwesome (например "fa-dumbbell")
    if (avatarData && avatarData.startsWith('fa-')) {
        // Делаем кружок с акцентным цветом и белой иконкой внутри
        return `<div class="avatar-fallback" style="background-color: var(--primary-color);" ${sizeClass}>
                    <i class="fa-solid ${avatarData}"></i>
                </div>`;
    }
    
    // Если это старая прямая ссылка на картинку (поддержка старых ботов)
    if (avatarData && avatarData.startsWith('http')) {
        return `<img src="${avatarData}" class="avatar-img" ${sizeClass} alt="${name}">`;
    }
    
    // Запасной вариант (буква), если вообще ничего нет
    const firstLetter = name ? name.trim().charAt(0).toUpperCase() : '?';
    let hash = 0;
    for (let i = 0; i < name.length; i++) { hash = name.charCodeAt(i) + ((hash << 5) - hash); }
    const colors = ['#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784'];
    const bgColor = colors[Math.abs(hash) % colors.length];
    
    return `<div class="avatar-fallback" style="background-color: ${bgColor};" ${sizeClass}>${firstLetter}</div>`;
}

function adjustColorBrightness(hex, percent) {
    let num = parseInt(hex.replace("#",""), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) + amt,
        G = (num >> 8 & 0x00FF) + amt,
        B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R<255?R<0?0:R:255)*0x10000 + (G<255?G<0?0:G:255)*0x100 + (B<255?B<0?0:B:255)).toString(16).slice(1);
}

// === ЖДЕМ ЗАГРУЗКИ DOM ===
document.addEventListener('DOMContentLoaded', () => {

    initTheme(); // Инициализация сохраненной темы

    // Клик на переключатель темы
    document.getElementById('btn-theme-toggle').addEventListener('click', toggleThemeMode);

    // События выбора цвета
    document.querySelectorAll('.color-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            setThemeColor(e.target.getAttribute('data-color'));
        });
    });

    // === НОВАЯ ЛОГИКА ВЫБОРА ИКОНКИ ===
    document.querySelectorAll('.icon-option').forEach(option => {
        option.addEventListener('click', (e) => {
            // Убираем класс active у всех
            document.querySelectorAll('.icon-option').forEach(el => el.classList.remove('active'));
            // Добавляем нажатому элементу
            const target = e.currentTarget;
            target.classList.add('active');
            // Сохраняем класс иконки в скрытое поле
            document.getElementById('ai-selected-icon').value = target.getAttribute('data-icon');
        });
    });

    document.getElementById('btn-attach').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('file-input').click();
    });

    document.getElementById('file-input').addEventListener('change', async (e) => {
        const files = e.target.files;
        for (let file of files) {
            const base64 = await fileToBase64(file);
            currentAttachments.push({ file, base64 });
        }
        renderPreviews();
        e.target.value = ''; 
    });

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

    document.getElementById('btn-settings').addEventListener('click', () => {
        renderSettingsKeys();
        document.getElementById('settings-modal').classList.remove('hidden');
    });

    document.getElementById('btn-close-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('hidden');
    });

    document.getElementById('btn-update-master').addEventListener('click', async () => {
        const newVal = document.getElementById('settings-master-key').value.trim();
        if (!newVal) return alert("Введите новый мастер-ключ!");

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

    document.getElementById('btn-add-setting-key').addEventListener('click', async () => {
        const input = document.getElementById('new-setting-key');
        const newVal = input.value.trim();
        if (!newVal) return;

        const currentMaster = masterApiKeyObj ? masterApiKeyObj.key_value.replace('MASTER::', '') : '';
        if (newVal === currentMaster) {
            return alert("Этот ключ уже используется как мастер-ключ!");
        }

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

document.getElementById('btn-new-ai').addEventListener('click', () => {
        document.getElementById('ai-modal-title').innerText = "Создать ИИ";
        document.getElementById('edit-ai-id').value = "";
        document.getElementById('ai-name').value = "";
        document.getElementById('ai-prompt').value = "";
        
        // Сброс иконки по умолчанию
        document.querySelectorAll('.icon-option').forEach(el => el.classList.remove('active'));
        document.querySelector('.icon-option[data-icon="fa-robot"]').classList.add('active');
        document.getElementById('ai-selected-icon').value = 'fa-robot';
        
        document.getElementById('new-ai-modal').classList.remove('hidden');
    });

    document.getElementById('btn-close-ai').addEventListener('click', () => {
        document.getElementById('new-ai-modal').classList.add('hidden');
    });

// Функцию openEditModal нужно вынести в глобальную область или объявить перед вызовом
    window.openEditModal = function(persona) {
        document.getElementById('ai-modal-title').innerText = "Редактировать ИИ";
        document.getElementById('edit-ai-id').value = persona.id;
        document.getElementById('ai-name').value = persona.name;
        document.getElementById('ai-prompt').value = persona.system_prompt;
        
        // Установка сохраненной иконки бота
        const savedIcon = persona.logo_url || 'fa-robot';
        document.querySelectorAll('.icon-option').forEach(el => el.classList.remove('active'));
        const iconEl = document.querySelector(`.icon-option[data-icon="${savedIcon}"]`);
        if (iconEl) {
            iconEl.classList.add('active');
            document.getElementById('ai-selected-icon').value = savedIcon;
        } else {
            // Если иконка не найдена (например, старая ссылка), просто выбираем робота
            document.querySelector('.icon-option[data-icon="fa-robot"]').classList.add('active');
            document.getElementById('ai-selected-icon').value = 'fa-robot';
        }

        document.getElementById('new-ai-modal').classList.remove('hidden');
    };

    document.getElementById('btn-save-ai').addEventListener('click', async () => {
        const id = document.getElementById('edit-ai-id').value;
        const name = document.getElementById('ai-name').value.trim();
        const prompt = document.getElementById('ai-prompt').value.trim();
        const selectedIcon = document.getElementById('ai-selected-icon').value; // Получаем выбранную иконку
        
        if (!name || !prompt) return alert("Заполните поля имени и промпта!");
        
        const payload = { 
            user_id: currentUser.id, 
            name, 
            system_prompt: prompt,
            logo_url: selectedIcon 
        };
        
        if (id) {
            delete payload.user_id; 
            await supabaseClient.from('ai_personas').update(payload).eq('id', id);
        } else {
            await supabaseClient.from('ai_personas').insert([payload]);
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
        
        if (!text && currentAttachments.length === 0) return;
        if (!currentPersona) return;

        const chatBox = document.getElementById('chat-messages');
        const attachmentsToSend = [...currentAttachments]; 
        
        input.value = '';
        currentAttachments = [];
        renderPreviews();

        let userMessageHtml = '';
        attachmentsToSend.forEach(att => {
            userMessageHtml += `<img src="${att.base64}" class="chat-img">`; 
        });
        if (text) userMessageHtml += `<div>${text}</div>`;
        
        chatBox.innerHTML += `<div class="msg user">${userMessageHtml}</div>`;
        chatBox.scrollTop = chatBox.scrollHeight;

        let geminiParts = [];
        if (text) geminiParts.push({ text: text });
        
        attachmentsToSend.forEach(att => {
            const pureBase64 = att.base64.split(',')[1];
            geminiParts.push({
                inlineData: {
                    data: pureBase64,
                    mimeType: att.file.type
                }
            });
        });

        currentChatHistory.push({ role: 'user', parts: geminiParts });

        let dbMessageHtml = '';
        const uploadIndicator = document.createElement('div');
        uploadIndicator.className = 'msg model typing';
        uploadIndicator.innerText = 'Обработка и загрузка файлов...';
        chatBox.appendChild(uploadIndicator);
        chatBox.scrollTop = chatBox.scrollHeight;

        try {
            for (let att of attachmentsToSend) {
                const fileExt = att.file.name.split('.').pop();
                const fileName = `${currentUser.id}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                
                const { data: uploadData, error: uploadError } = await supabaseClient.storage
                    .from('chat-images')
                    .upload(fileName, att.file);
                    
                if (uploadError) throw new Error("Ошибка загрузки картинки: " + uploadError.message);

                const { data: publicUrlData } = supabaseClient.storage.from('chat-images').getPublicUrl(fileName);
                dbMessageHtml += `<img src="${publicUrlData.publicUrl}" class="chat-img"><br>`;
            }
            if (text) dbMessageHtml += text;

            await supabaseClient.from('chat_messages').insert([{
                user_id: currentUser.id, 
                persona_id: currentPersona.id, 
                role: 'user', 
                message_text: dbMessageHtml || text 
            }]);

            uploadIndicator.innerText = 'Печатает...';

            if (currentChatHistory.length >= 30) await compressMemory();

            const reply = await sendGeminiChatRequest(currentChatHistory, currentPersona.system_prompt);
            uploadIndicator.remove();

            chatBox.innerHTML += `<div class="msg model">${reply}</div>`;
            chatBox.scrollTop = chatBox.scrollHeight;

            currentChatHistory.push({ role: 'model', parts: [{ text: reply }] });

            await supabaseClient.from('chat_messages').insert([{
                user_id: currentUser.id, persona_id: currentPersona.id, role: 'model', message_text: reply
            }]);

        } catch (error) {
            if (uploadIndicator) uploadIndicator.remove();
            alert(error.message);
            if (chatBox.lastElementChild && chatBox.lastElementChild.classList.contains('user')) {
                chatBox.lastElementChild.remove();
            }
            currentChatHistory.pop(); 
        }
    });

}); 

// === СИСТЕМА КЛЮЧЕЙ С МАСКИРОВАНИЕМ ===
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
    // Маскируем отображение Мастер-ключа
    const masterVal = masterApiKeyObj ? masterApiKeyObj.key_value : null;
    document.getElementById('current-master-display').innerText = `Текущий: ${maskKey(masterVal)}`;
    document.getElementById('settings-master-key').value = '';

    const container = document.getElementById('settings-keys-list');
    container.innerHTML = '';
    userApiKeys.forEach(k => {
        const row = document.createElement('div');
        row.className = 'key-row';
        // Маскируем отображение обычных ключей
        row.innerHTML = `
            <span class="key-text" title="Ключ скрыт в целях безопасности">${maskKey(k.key_value)}</span>
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
    document.getElementById('active-chat-avatar').innerHTML = '';
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
            if (currentPersona && currentPersona.id === persona.id) {
                li.classList.add('active');
            }
            li.onclick = () => selectPersona(persona);
            
            // Получаем аватар 
            const avatarHtml = getAvatarHtml(persona.name, persona.logo_url);
            
            li.innerHTML = `
                ${avatarHtml}
                <span class="ai-name">${persona.name}</span>
                <div class="ai-actions">
                    <button class="btn-edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-del"><i class="fa-solid fa-trash"></i></button>
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
    
    // Подсвечиваем активного бота в боковом меню
    document.querySelectorAll('.ai-item').forEach(el => el.classList.remove('active'));
    await loadPersonas(); // Перегрузим список чтобы обновился класс .active и аватар

    const chatHeader = document.getElementById('chat-header-text');
    const chatBox = document.getElementById('chat-messages');
    const avatarHeaderContainer = document.getElementById('active-chat-avatar');
    
    // Ставим аватарку и имя в шапке чата
    chatHeader.innerText = persona.name;
    avatarHeaderContainer.innerHTML = getAvatarHtml(persona.name, persona.logo_url, true);
    
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
    document.getElementById('ai-avatar-url').value = persona.logo_url || "";
    document.getElementById('ai-prompt').value = persona.system_prompt;
    document.getElementById('new-ai-modal').classList.remove('hidden');
}

async function deletePersona(id) {
    if (!confirm("Удалить ИИ?")) return;
    await supabaseClient.from('ai_personas').delete().eq('id', id);
    if (currentPersona && currentPersona.id === id) startApp(); else await loadPersonas();
}

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

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

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

window.removeAttachment = function(index) {
    currentAttachments.splice(index, 1);
    renderPreviews();
};