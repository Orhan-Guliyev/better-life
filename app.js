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

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

// === СИСТЕМА УПРАВЛЕНИЯ ТЕМОЙ ===
function initTheme() {
    const savedMode = localStorage.getItem('theme-mode') || 'light';
    const storedColor = localStorage.getItem('theme-color');
    const savedColor = /^#[0-9a-f]{6}$/i.test(storedColor || '') ? storedColor : '#7257f5';
    
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
    document.querySelector('meta[name="theme-color"]').setAttribute('content', savedColor);
    
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
    document.querySelector('meta[name="theme-color"]').setAttribute('content', color);
    
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
    name = String(name || '');
    const sizeClass = isSmall ? 'style="width:35px; height:35px; font-size:16px;"' : '';
    
    // Если это иконка из FontAwesome (например "fa-dumbbell")
    if (avatarData && avatarData.startsWith('fa-')) {
        const iconClass = escapeHtml(avatarData);
        // Делаем кружок с акцентным цветом и белой иконкой внутри
        return `<div class="avatar-fallback" style="background-color: var(--primary-color);" ${sizeClass}>
                    <i class="fa-solid ${iconClass}"></i>
                </div>`;
    }
    
    // Если это старая прямая ссылка на картинку (поддержка старых ботов)
    if (avatarData && avatarData.startsWith('http')) {
        return `<img src="${escapeHtml(avatarData)}" class="avatar-img" ${sizeClass} alt="${escapeHtml(name)}">`;
    }
    
    // Запасной вариант (буква), если вообще ничего нет
    const firstLetter = name ? name.trim().charAt(0).toUpperCase() : '?';
    let hash = 0;
    for (let i = 0; i < name.length; i++) { hash = name.charCodeAt(i) + ((hash << 5) - hash); }
    const colors = ['#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784'];
    const bgColor = colors[Math.abs(hash) % colors.length];
    
    return `<div class="avatar-fallback" style="background-color: ${bgColor};" ${sizeClass}>${firstLetter}</div>`;
}

function createMessageBubble(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `msg ${role === 'user' ? 'user' : 'model'}`;
    bubble.textContent = text || '';
    return bubble;
}

function createTypingIndicator(label) {
    const indicator = document.createElement('div');
    indicator.className = 'msg model typing';
    indicator.setAttribute('role', 'status');

    const statusText = document.createElement('span');
    statusText.textContent = label;
    const dots = document.createElement('span');
    dots.className = 'typing-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<span></span><span></span><span></span>';

    indicator.append(statusText, dots);
    return indicator;
}

function appendStoredMessage(container, role, messageText) {
    const bubble = createMessageBubble(role, '');
    const parsed = new DOMParser().parseFromString(String(messageText || ''), 'text/html');
    const allowedImageOrigin = new URL(SUPABASE_URL).origin;

    function appendNodes(nodes) {
        nodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                bubble.appendChild(document.createTextNode(node.textContent));
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'IMG') {
                    try {
                        const imageUrl = new URL(node.getAttribute('src'), allowedImageOrigin);
                        if (imageUrl.origin === allowedImageOrigin &&
                            imageUrl.pathname.startsWith('/storage/v1/object/public/chat-images/')) {
                            const image = document.createElement('img');
                            image.src = imageUrl.href;
                            image.alt = 'Изображение из сообщения';
                            image.className = 'chat-img';
                            bubble.appendChild(image);
                        }
                    } catch {
                        return;
                    }
                } else if (node.tagName === 'BR') {
                    bubble.appendChild(document.createTextNode('\n'));
                } else if (node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
                    appendNodes(Array.from(node.childNodes));
                }
            }
        });
    }

    appendNodes(Array.from(parsed.body.childNodes));
    container.appendChild(bubble);
    return bubble;
}

function adjustColorBrightness(hex, percent) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#5c42df';
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
            setThemeColor(e.currentTarget.getAttribute('data-color'));
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
        const input = e.currentTarget;
        try {
            for (const file of Array.from(input.files || [])) {
                if (!file.type.startsWith('image/')) {
                    throw new Error("Можно прикреплять только изображения.");
                }
                const base64 = await fileToBase64(file);
                currentAttachments.push({ file, base64 });
            }
            renderPreviews();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'проверьте формат изображения';
            alert(`Не удалось загрузить изображение: ${message}`);
            renderPreviews();
        } finally {
            input.value = '';
        }
    });

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (session) {
            currentUser = session.user;
            document.getElementById('auth-screen').classList.add('hidden');
            try {
                await checkApiKeys();
            } catch (error) {
                alert(error.message);
            }
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
        const { error } = await supabaseClient.auth.signOut();
        if (error) alert(`Не удалось выйти: ${error.message}`);
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
                try {
                    await checkApiKeys();
                } catch (error) {
                    alert(error.message);
                }
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

    document.getElementById('btn-back-to-list').addEventListener('click', () => {
        document.getElementById('app-screen').classList.remove('is-chat-open');
    });

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', event => {
            if (event.target === modal && modal.id !== 'api-key-modal') {
                modal.classList.add('hidden');
            }
        });
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            document.querySelectorAll('.modal:not(.hidden)').forEach(modal => {
                if (modal.id !== 'api-key-modal') modal.classList.add('hidden');
            });
        }
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

    window.openEditModal = function(persona) {
        document.getElementById('ai-modal-title').innerText = "Редактировать ИИ";
        document.getElementById('edit-ai-id').value = persona.id;
        document.getElementById('ai-name').value = persona.name;
        document.getElementById('ai-prompt').value = persona.system_prompt;
        
        // Установка сохраненной иконки бота
        const savedIcon = persona.logo_url || 'fa-robot';
        document.querySelectorAll('.icon-option').forEach(el => el.classList.remove('active'));
        const iconEl = Array.from(document.querySelectorAll('.icon-option'))
            .find(el => el.getAttribute('data-icon') === savedIcon);
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
        
        let saveError;
        if (id) {
            delete payload.user_id;
            ({ error: saveError } = await supabaseClient.from('ai_personas').update(payload).eq('id', id));
        } else {
            ({ error: saveError } = await supabaseClient.from('ai_personas').insert([payload]));
        }
        if (saveError) {
            alert(`Не удалось сохранить ИИ: ${saveError.message}`);
            return;
        }
        document.getElementById('new-ai-modal').classList.add('hidden');
        await loadPersonas();
    });

    document.getElementById('btn-clear-chat').addEventListener('click', async () => {
        if (!currentPersona) return;
        if (document.getElementById('btn-send').disabled) return;
        if (!confirm("Очистить историю сообщений? Контекст будет сохранен в долгосрочную память.")) return;

        const chatBox = document.getElementById('chat-messages');
        const indicator = document.createElement('div');
        indicator.className = 'msg model typing';
        indicator.textContent = 'Архивирую сообщения в память...';
        chatBox.appendChild(indicator);
        chatBox.scrollTop = chatBox.scrollHeight;

        try {
            if (currentChatHistory.length > 0) await compressMemory();

            const { error } = await supabaseClient.from('chat_messages').delete().eq('persona_id', currentPersona.id);
            if (error) throw error;
            currentChatHistory = currentSummary ? [
                { role: 'user', parts: [{ text: `[Важная системная память из прошлых бесед: ${currentSummary}]` }] },
                { role: 'model', parts: [{ text: "[Внутренняя память успешно синхронизирована.]" }] }
            ] : [];
            chatBox.innerHTML = '';
            alert("Экран очищен! Детали сохранены в памяти ИИ.");
        } catch (error) {
            alert(`Не удалось очистить чат: ${error.message}`);
        } finally {
            indicator.remove();
        }
    });

    document.getElementById('btn-send').addEventListener('click', async () => {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        
        if (!text && currentAttachments.length === 0) return;
        if (!currentPersona) return;

        const chatBox = document.getElementById('chat-messages');
        const attachmentsToSend = [...currentAttachments]; 
        const sendButton = document.getElementById('btn-send');
        if (sendButton.disabled) return;
        sendButton.disabled = true;
        const historyLengthBeforeSend = currentChatHistory.length;
        let userMessageElement = null;
        let userMessageSaved = false;
        
        input.value = '';
        currentAttachments = [];
        renderPreviews();

        userMessageElement = document.createElement('div');
        userMessageElement.className = 'msg user';
        attachmentsToSend.forEach(att => {
            const image = document.createElement('img');
            image.src = att.base64;
            image.alt = 'Прикреплённое изображение';
            image.className = 'chat-img';
            userMessageElement.appendChild(image);
        });
        if (text) userMessageElement.appendChild(document.createTextNode(text));
        chatBox.appendChild(userMessageElement);
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
        let uploadIndicator = createTypingIndicator(
            attachmentsToSend.length ? 'Разбираю вложения' : 'Собираю мысли'
        );
        chatBox.appendChild(uploadIndicator);
        chatBox.scrollTop = chatBox.scrollHeight;
        let responseBubble = null;
        let streamedReply = '';

        function showTypingStatus(label) {
            uploadIndicator.remove();
            uploadIndicator = createTypingIndicator(label);
            chatBox.appendChild(uploadIndicator);
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        try {
            for (let att of attachmentsToSend) {
                const fileExt = att.file.name.split('.').pop();
                const fileName = `${currentUser.id}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                
                const { error: uploadError } = await supabaseClient.storage
                    .from('chat-images')
                    .upload(fileName, att.file);
                    
                if (uploadError) throw new Error("Ошибка загрузки картинки: " + uploadError.message);

                const { data: publicUrlData } = supabaseClient.storage.from('chat-images').getPublicUrl(fileName);
                dbMessageHtml += `<img src="${publicUrlData.publicUrl}" class="chat-img"><br>`;
            }
            if (text) dbMessageHtml += text;

            const { error: userMessageError } = await supabaseClient.from('chat_messages').insert([{
                user_id: currentUser.id, 
                persona_id: currentPersona.id, 
                role: 'user', 
                message_text: dbMessageHtml || text 
            }]);
            if (userMessageError) throw userMessageError;
            userMessageSaved = true;

            if (currentChatHistory.length >= 30) await compressMemory();

            showTypingStatus(`${currentPersona.name} думает`);
            const reply = await sendGeminiChatRequest(
                currentChatHistory,
                currentPersona.system_prompt,
                chunk => {
                    if (!responseBubble) {
                        uploadIndicator.remove();
                        responseBubble = createMessageBubble('model', '');
                        responseBubble.classList.add('streaming');
                        chatBox.appendChild(responseBubble);
                    }
                    streamedReply += chunk;
                    responseBubble.textContent = streamedReply;
                    chatBox.scrollTop = chatBox.scrollHeight;
                },
                () => {
                    streamedReply = '';
                    if (responseBubble) responseBubble.remove();
                    responseBubble = null;
                    showTypingStatus('Подбираю лучший ответ');
                }
            );
            uploadIndicator.remove();

            if (!responseBubble) {
                responseBubble = createMessageBubble('model', reply);
                chatBox.appendChild(responseBubble);
            } else {
                responseBubble.classList.remove('streaming');
                responseBubble.textContent = reply;
            }
            chatBox.scrollTop = chatBox.scrollHeight;

            currentChatHistory.push({ role: 'model', parts: [{ text: reply }] });

            const { error: replySaveError } = await supabaseClient.from('chat_messages').insert([{
                user_id: currentUser.id, persona_id: currentPersona.id, role: 'model', message_text: reply
            }]);
            if (replySaveError) throw replySaveError;

        } catch (error) {
            if (uploadIndicator) uploadIndicator.remove();
            alert(error.message || 'Не удалось отправить сообщение.');
            if (userMessageSaved) {
                if (responseBubble && !streamedReply) responseBubble.remove();
                else if (responseBubble) responseBubble.classList.remove('streaming');
                chatBox.appendChild(createMessageBubble('model', 'Не удалось получить или сохранить ответ. Ваше сообщение осталось в чате.'));
            } else {
                if (userMessageElement) userMessageElement.remove();
                currentChatHistory.length = historyLengthBeforeSend;
                input.value = text;
                currentAttachments = attachmentsToSend;
                renderPreviews();
            }
        }
        sendButton.disabled = false;
    });

    document.getElementById('message-input').addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            document.getElementById('btn-send').click();
        }
    });

}); 

// === СИСТЕМА КЛЮЧЕЙ С МАСКИРОВАНИЕМ ===
async function checkApiKeys() {
    const { data, error } = await supabaseClient.from('api_keys').select('id, key_value');
    if (error) throw new Error(`Не удалось загрузить API-ключи: ${error.message}`);
    
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
        const keyText = document.createElement('span');
        keyText.className = 'key-text';
        keyText.title = 'Ключ скрыт в целях безопасности';
        keyText.textContent = maskKey(k.key_value);
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Удалить';
        deleteButton.addEventListener('click', () => deleteApiKey(k.id));
        row.append(keyText, deleteButton);
        container.appendChild(row);
    });
}

async function deleteApiKey(id) {
    if (userApiKeys.length <= 1) return alert("Нельзя удалить единственный обычный ключ!");
    const { error } = await supabaseClient.from('api_keys').delete().eq('id', id);
    if (error) alert(error.message);
    else {
        userApiKeys = userApiKeys.filter(k => k.id !== id);
        renderSettingsKeys();
    }
}

// === ЯДРО ПРИЛОЖЕНИЯ ===
async function startApp() {
    const appScreen = document.getElementById('app-screen');
    appScreen.classList.remove('hidden', 'is-chat-open');
    document.getElementById('chat-input-area').classList.add('hidden'); 
    document.getElementById('chat-header-text').innerText = `Выберите ИИ для начала общения`;
    document.getElementById('active-chat-avatar').innerHTML = '';
    document.getElementById('btn-clear-chat').classList.add('hidden');
    document.getElementById('chat-messages').innerHTML = `
        <div class="welcome-card">
            <div class="welcome-mark"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
            <h2>Идеи становятся проще</h2>
            <p>Выберите ИИ слева, чтобы начать разговор. Создайте собственных помощников под свои цели и интересы.</p>
        </div>
    `;
    currentPersona = null;
    currentChatHistory = [];
    currentSummary = "";
    await loadPersonas();
}

async function loadPersonas() {
    const { data, error } = await supabaseClient.from('ai_personas').select('*').order('created_at', { ascending: true });
    if (error) {
        alert(`Не удалось загрузить список ИИ: ${error.message}`);
        return;
    }
    const list = document.getElementById('ai-list');
    list.innerHTML = '';
    if (data) {
        data.forEach(persona => {
            const li = document.createElement('li');
            li.className = 'ai-item';
            li.dataset.personaId = String(persona.id);
            if (currentPersona && currentPersona.id === persona.id) {
                li.classList.add('active');
            }
            li.onclick = () => {
                if (!document.getElementById('btn-send').disabled) selectPersona(persona);
            };
            
            // Получаем аватар 
            const avatarHtml = getAvatarHtml(persona.name, persona.logo_url);
            
            li.innerHTML = `
                ${avatarHtml}
                <span class="ai-name">${escapeHtml(persona.name)}</span>
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
    document.getElementById('app-screen').classList.add('is-chat-open');
    
    document.querySelectorAll('.ai-item').forEach(el => {
        el.classList.toggle('active', el.dataset.personaId === String(persona.id));
    });

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

    const { data, error } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .eq('persona_id', persona.id)
        .order('created_at', { ascending: true });

    if (!currentPersona || currentPersona.id !== persona.id) return;
    chatBox.innerHTML = ''; 

    if (error) {
        chatBox.appendChild(createMessageBubble('model', `Не удалось загрузить историю: ${error.message}`));
        return;
    }

    if (data && data.length > 0) {
        data.forEach(msg => {
            appendStoredMessage(chatBox, msg.role, msg.message_text);
            currentChatHistory.push({ role: msg.role, parts: [{ text: msg.message_text }] });
        });
    }
    chatBox.scrollTop = chatBox.scrollHeight;
}

async function deletePersona(id) {
    if (!confirm("Удалить ИИ?")) return;
    const { error } = await supabaseClient.from('ai_personas').delete().eq('id', id);
    if (error) {
        alert(`Не удалось удалить ИИ: ${error.message}`);
        return;
    }
    if (currentPersona && currentPersona.id === id) startApp(); else await loadPersonas();
}

async function fetchFromApi(model, apiKey, contents, systemInstructionText, onText) {
    const streaming = typeof onText === 'function';
    const method = streaming ? 'streamGenerateContent' : 'generateContent';
    const query = streaming ? `?alt=sse&key=${encodeURIComponent(apiKey)}` : `?key=${encodeURIComponent(apiKey)}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}${query}`;
    const body = { contents: contents };
    if (systemInstructionText) body.system_instruction = { parts: [{ text: systemInstructionText }] };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!streaming) {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Ошибка API');
        const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
        if (!text) throw new Error('Модель вернула пустой ответ.');
        return text;
    }

    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Ошибка API');
    }
    if (!response.body) throw new Error('Потоковый ответ недоступен в этом браузере.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    function processEvent(eventText) {
        const dataLines = eventText
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim());
        if (!dataLines.length) return;

        const payload = dataLines.join('\n');
        if (!payload || payload === '[DONE]') return;
        const chunkData = JSON.parse(payload);
        const chunkText = chunkData.candidates?.[0]?.content?.parts
            ?.map(part => part.text || '')
            .join('') || '';
        if (chunkText) {
            fullText += chunkText;
            onText(chunkText);
        }
    }

    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

            let boundary;
            while ((boundary = buffer.match(/\r?\n\r?\n/)) !== null) {
                processEvent(buffer.slice(0, boundary.index).replace(/\r/g, ''));
                buffer = buffer.slice(boundary.index + boundary[0].length);
            }

            if (done) break;
        }
        if (buffer.trim()) processEvent(buffer.replace(/\r/g, ''));
    } finally {
        reader.releaseLock();
    }

    if (!fullText) throw new Error('Модель вернула пустой ответ.');
    return fullText;
}

async function sendGeminiChatRequest(contents, systemInstructionText, onText, onRetry) {
    for (let model of GEMINI_MODELS) {
        for (let keyObj of userApiKeys) {
            try {
                return await fetchFromApi(model, keyObj.key_value, contents, systemInstructionText, onText);
            } catch (e) {
                console.warn(`[Чат] Сбой на модели ${model} с одним из ключей`);
                if (onRetry) onRetry();
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
    const dialogSnapshot = currentChatHistory
        .map(message => {
            const content = message.parts
                .map(part => part.text || (part.inlineData ? '[изображение]' : ''))
                .filter(Boolean)
                .join(' ');
            return `${message.role === 'user' ? 'Пользователь' : 'ИИ'}: ${content}`;
        })
        .join('\n');

    const compressionPrompt = `Извлеки все важные факты о пользователе и контекст. Сформируй обновленную базу знаний.
    Предыдущая память: ${currentSummary || 'Отсутствует'}
    Новые сообщения: ${dialogSnapshot}`;

    const compressedResult = await makeMemoryNetworkCall([{ role: 'user', parts: [{ text: compressionPrompt }] }]);
    const { error } = await supabaseClient
        .from('ai_personas')
        .update({ ai_memory: compressedResult })
        .eq('id', currentPersona.id);
    if (error) throw new Error(`Не удалось сохранить память: ${error.message}`);

    currentSummary = compressedResult;
    currentPersona.ai_memory = compressedResult;
    currentChatHistory = [
        { role: 'user', parts: [{ text: `[Важная системная память из прошлых бесед: ${currentSummary}]` }] },
        { role: 'model', parts: [{ text: "[Контекст успешно оптимизирован.]" }] }
    ];
    console.log("Память обновлена.");
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